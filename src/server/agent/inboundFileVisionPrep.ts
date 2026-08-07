import { toFile } from '@anthropic-ai/sdk';
import { getAnthropic, FILES_BETA } from '@/src/agent/anthropic';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { INBOUND_FILES_TABLE, type VisionStatus } from './inboundFiles';

// Turning a staged file into something the model can actually look at.
//
// Every staged file gets ONE canonical renderable artifact, resolved once here
// and reused on every turn afterwards:
//
//   images  -> transcoded if needed, uploaded, referenced by anthropic_file_id
//   PDFs    -> uploaded as-is, referenced by anthropic_file_id
//   text-ish-> extracted into vision_text and inlined at render time
//   the rest-> nothing, and a sentence saying why
//
// Resolving once is the whole point. A file id is a UUID on the wire, so a
// photo can stay in view for an entire conversation without re-sending three
// megabytes of base64 every turn.
//
// TWO RULES THIS MODULE KEEPS
//
// It never throws. A file that can't be prepared is a file the agent describes
// honestly ("I can't open that one — it's a 312-page PDF"), never a turn that
// errors out. Every failure path lands in a status and a note.
//
// It never touches the original. storage_path stays exactly as uploaded,
// because that is what attachInboundFile.ts copies onto tasks and Property
// Knowledge — a user's HEIC should arrive on the task as the HEIC they took.
// The transcoded JPEG exists only for the model and is never written back.

/** Formats the Messages API accepts directly. Anything else must be converted. */
const DIRECT_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

/**
 * iPhone photos. sharp is already in the tree and would be the obvious tool,
 * but its prebuilt libvips ships the AVIF-only libheif build and cannot decode
 * HEVC at all — hence the separate WASM decoder.
 */
const HEIF_TYPES = new Set(['image/heic', 'image/heif', 'image/heic-sequence']);
const HEIF_EXTENSIONS = new Set(['heic', 'heif']);

/** Raster formats sharp can read and re-encode as JPEG. */
const SHARP_IMAGE_TYPES = new Set([
  'image/avif',
  'image/tiff',
  'image/bmp',
  'image/x-ms-bmp',
]);

const TEXT_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/tab-separated-values',
  'application/json',
  'application/xml',
  'text/xml',
]);
const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'csv',
  'tsv',
  'json',
  'xml',
  'log',
  'yml',
  'yaml',
]);

const DOCX_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroenabled.12',
]);

/**
 * Sonnet 5's high-resolution tier tops out at 2576px on the long edge, so
 * anything larger is detail the model will never see. Downscaling here rather
 * than letting the API do it keeps the upload small too.
 */
const MAX_IMAGE_EDGE = 2576;

/**
 * PDFs are billed per page — each page arrives as both text and an image — so
 * a 300-page scan is hundreds of thousands of tokens regardless of how few
 * megabytes it is. Bytes are a crude proxy for page count, but they're a proxy
 * we can compute without a PDF parser, and they're conservative in the right
 * direction: the documents this exists for (invoices, inspection reports,
 * appliance manuals) are comfortably under it.
 */
const MAX_PDF_BYTES = 12 * 1024 * 1024;

/** Hard ceiling on what we'll keep in vision_text. Render truncates further. */
const MAX_STORED_TEXT_CHARS = 200_000;

/** How many files prepare at once. Transcoding is CPU-bound; don't swamp the lambda. */
const PREP_CONCURRENCY = 3;

interface PrepRow {
  id: string;
  name: string;
  mime_type: string | null;
  size_bytes: number | null;
  storage_bucket: string;
  storage_path: string;
  vision_status: VisionStatus;
}

interface PrepOutcome {
  status: VisionStatus;
  anthropicFileId?: string | null;
  mediaType?: string | null;
  text?: string | null;
  note?: string | null;
}

function extensionOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Which pipeline a file goes down.
 *
 * Reads the extension as well as the mime type on purpose. Slack reports mime
 * types reliably; browsers do not — iOS in particular hands over HEIC as
 * `application/octet-stream` often enough that a mime-only check would send
 * every iPhone photo to the unsupported branch.
 */
function resolveKind(
  mime: string | null,
  name: string,
):
  | 'image-direct'
  | 'image-heif'
  | 'image-convert'
  | 'pdf'
  | 'text'
  | 'docx'
  | 'xlsx'
  | 'unsupported' {
  const m = (mime || '').toLowerCase();
  const ext = extensionOf(name);

  if (DIRECT_IMAGE_TYPES.has(m)) return 'image-direct';
  if (HEIF_TYPES.has(m) || HEIF_EXTENSIONS.has(ext)) return 'image-heif';
  if (SHARP_IMAGE_TYPES.has(m) || ['avif', 'tiff', 'tif', 'bmp'].includes(ext)) {
    return 'image-convert';
  }
  if (m === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (m === DOCX_TYPE || ext === 'docx') return 'docx';
  if (XLSX_TYPES.has(m) || ['xlsx', 'xlsm'].includes(ext)) return 'xlsx';
  if (TEXT_MIME_TYPES.has(m) || m.startsWith('text/') || TEXT_EXTENSIONS.has(ext)) {
    return 'text';
  }
  // Covers SVG (a script vector, not a raster the API accepts), legacy .doc and
  // .xls binaries, video, archives, and anything unrecognised.
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'image-direct';
  return 'unsupported';
}

/** Human phrasing for a format we will never be able to show. */
function unsupportedNote(name: string, mime: string | null): string {
  const ext = extensionOf(name);
  if (ext === 'svg' || mime === 'image/svg+xml') {
    return 'SVG images can’t be displayed';
  }
  if (ext === 'doc') return 'older .doc files can’t be read (only .docx)';
  if (ext === 'xls') return 'older .xls files can’t be read (only .xlsx)';
  if ((mime || '').startsWith('video/')) return 'video can’t be viewed';
  if ((mime || '').startsWith('audio/')) return 'audio can’t be played';
  return 'this file type can’t be opened';
}

async function uploadToAnthropic(
  bytes: Buffer,
  filename: string,
  mediaType: string,
): Promise<string> {
  const uploaded = await getAnthropic().beta.files.upload(
    { file: await toFile(bytes, filename, { type: mediaType }) },
    { headers: { 'anthropic-beta': FILES_BETA } },
  );
  return uploaded.id;
}

/** Downscale to the model's useful ceiling and normalise to JPEG. */
async function toBoundedJpeg(bytes: Buffer): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  return sharp(bytes)
    .rotate() // honour EXIF orientation before we discard the metadata
    .resize({
      width: MAX_IMAGE_EDGE,
      height: MAX_IMAGE_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 82 })
    .toBuffer();
}

async function prepareImage(
  row: PrepRow,
  bytes: Buffer,
  kind: 'image-direct' | 'image-heif' | 'image-convert',
): Promise<PrepOutcome> {
  let payload = bytes;
  let mediaType = (row.mime_type || 'image/jpeg').toLowerCase();

  if (kind === 'image-heif') {
    const convert = (await import('heic-convert')).default;
    const jpeg = await convert({ buffer: bytes, format: 'JPEG', quality: 0.82 });
    payload = await toBoundedJpeg(Buffer.from(jpeg));
    mediaType = 'image/jpeg';
  } else if (kind === 'image-convert') {
    payload = await toBoundedJpeg(bytes);
    mediaType = 'image/jpeg';
  } else if (!DIRECT_IMAGE_TYPES.has(mediaType)) {
    // Extension said jpeg/png but the mime type was junk (octet-stream, empty).
    // Re-encode so what we upload and what we claim to upload agree.
    payload = await toBoundedJpeg(bytes);
    mediaType = 'image/jpeg';
  } else if (mediaType !== 'image/gif' && payload.byteLength > 3 * 1024 * 1024) {
    // Large but already-supported stills get downscaled too — a 12MP PNG is
    // mostly pixels the model can't resolve. GIFs are left alone so animation
    // frames survive.
    payload = await toBoundedJpeg(bytes);
    mediaType = 'image/jpeg';
  }

  const fileId = await uploadToAnthropic(payload, row.name, mediaType);
  return { status: 'ready', anthropicFileId: fileId, mediaType };
}

async function preparePdf(row: PrepRow, bytes: Buffer): Promise<PrepOutcome> {
  if (bytes.byteLength > MAX_PDF_BYTES) {
    return {
      status: 'unsupported',
      note: `${formatBytes(bytes.byteLength)} PDF — too large to read`,
    };
  }
  const fileId = await uploadToAnthropic(bytes, row.name, 'application/pdf');
  return { status: 'ready', anthropicFileId: fileId, mediaType: 'application/pdf' };
}

function clipStoredText(text: string): string {
  return text.length > MAX_STORED_TEXT_CHARS
    ? text.slice(0, MAX_STORED_TEXT_CHARS)
    : text;
}

async function prepareText(bytes: Buffer): Promise<PrepOutcome> {
  // Strip a UTF-8 BOM: Excel-exported CSVs carry one and it otherwise arrives
  // glued to the first column header.
  const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
  if (!text.trim()) {
    return { status: 'unsupported', note: 'the file is empty' };
  }
  return { status: 'text', text: clipStoredText(text) };
}

async function prepareDocx(bytes: Buffer): Promise<PrepOutcome> {
  const mammoth = await import('mammoth');
  const { value } = await mammoth.extractRawText({ buffer: bytes });
  if (!value.trim()) {
    return { status: 'unsupported', note: 'the document has no readable text' };
  }
  return { status: 'text', text: clipStoredText(value) };
}

/**
 * One spreadsheet cell as a string.
 *
 * exceljs hands back a small union rather than a scalar, and every arm of it
 * shows up in real files: a formula cell is `{formula, result}`, a cell with
 * one bolded word is `{richText: [...]}`, a linked cell is `{text, hyperlink}`,
 * a date is a Date. Miss an arm and that content silently becomes an empty
 * column — which reads, to the model, as a blank the user never filled in.
 */
function cellToText(cell: unknown): string {
  if (cell == null) return '';
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  if (typeof cell !== 'object') return String(cell);

  const v = cell as {
    text?: unknown;
    result?: unknown;
    formula?: string;
    richText?: Array<{ text?: unknown }>;
    error?: unknown;
  };
  if (Array.isArray(v.richText)) {
    return v.richText.map((run) => String(run?.text ?? '')).join('');
  }
  if (v.text != null) return String(v.text);
  // Prefer a formula's computed value over the formula itself — "=SUM(B2:B9)"
  // tells the model nothing that "4820" doesn't.
  if (v.result != null) return cellToText(v.result);
  if (v.error != null) return String(v.error);
  if (v.formula != null) return `=${v.formula}`;
  return '';
}

/**
 * Flatten a workbook to text, one CSV-ish block per sheet.
 *
 * Sheet names are kept because they usually carry meaning in the documents
 * this sees ("Q1", "Labor", "Parts"), and a bare grid of numbers with no
 * heading is not something anyone can reason about.
 */
async function prepareXlsx(bytes: Buffer): Promise<PrepOutcome> {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ArrayBuffer);

  const parts: string[] = [];
  workbook.eachSheet((sheet) => {
    const rows: string[] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      const cells = values.map((cell) => cellToText(cell));
      if (cells.some((c) => c.trim() !== '')) {
        rows.push(cells.join('\t'));
      }
    });
    if (rows.length > 0) {
      parts.push(`--- Sheet: ${sheet.name} ---\n${rows.join('\n')}`);
    }
  });

  if (parts.length === 0) {
    return { status: 'unsupported', note: 'the spreadsheet has no readable cells' };
  }
  return { status: 'text', text: clipStoredText(parts.join('\n\n')) };
}

async function writeOutcome(fileId: string, outcome: PrepOutcome): Promise<void> {
  const supabase = getSupabaseServer();
  const { error } = await supabase
    .from(INBOUND_FILES_TABLE)
    .update({
      vision_status: outcome.status,
      anthropic_file_id: outcome.anthropicFileId ?? null,
      vision_media_type: outcome.mediaType ?? null,
      vision_text: outcome.text ?? null,
      vision_note: outcome.note ?? null,
      vision_prepared_at: new Date().toISOString(),
    })
    .eq('id', fileId);
  if (error) {
    console.error('[vision prep] status write failed', { fileId, error });
  }
}

/**
 * Resolve one staged file's renderable artifact.
 *
 * Idempotent: a file already in a settled state returns immediately, so this is
 * safe to call from staging (eagerly, off the response path) and again from the
 * render path (lazily, for anything still pending). That double-call is what
 * makes staging-time prep an optimisation rather than a correctness
 * requirement, and it's also what backfills every row that predates vision —
 * there is no migration job to run.
 *
 * 'failed' is retried on the next call; 'unsupported' never is.
 */
export async function ensureVisionArtifact(
  fileId: string,
): Promise<VisionStatus> {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from(INBOUND_FILES_TABLE)
    .select(
      'id, name, mime_type, size_bytes, storage_bucket, storage_path, vision_status',
    )
    .eq('id', fileId)
    .maybeSingle();

  if (error || !data) {
    console.error('[vision prep] row load failed', { fileId, error });
    return 'failed';
  }

  const row = data as PrepRow;
  if (
    row.vision_status === 'ready' ||
    row.vision_status === 'text' ||
    row.vision_status === 'unsupported'
  ) {
    return row.vision_status;
  }

  const kind = resolveKind(row.mime_type, row.name);
  if (kind === 'unsupported') {
    const outcome: PrepOutcome = {
      status: 'unsupported',
      note: unsupportedNote(row.name, row.mime_type),
    };
    await writeOutcome(fileId, outcome);
    return outcome.status;
  }

  let outcome: PrepOutcome;
  try {
    const { data: blob, error: dlError } = await supabase.storage
      .from(row.storage_bucket)
      .download(row.storage_path);
    if (dlError || !blob) throw new Error(dlError?.message ?? 'no data');
    const bytes = Buffer.from(await blob.arrayBuffer());

    switch (kind) {
      case 'image-direct':
      case 'image-heif':
      case 'image-convert':
        outcome = await prepareImage(row, bytes, kind);
        break;
      case 'pdf':
        outcome = await preparePdf(row, bytes);
        break;
      case 'text':
        outcome = await prepareText(bytes);
        break;
      case 'docx':
        outcome = await prepareDocx(bytes);
        break;
      case 'xlsx':
        outcome = await prepareXlsx(bytes);
        break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[vision prep] failed', { fileId, kind, message });
    outcome = {
      status: 'failed',
      // Deliberately generic. This string is read aloud to the user by the
      // agent, and a decoder stack trace is not an explanation.
      note:
        kind === 'image-heif'
          ? 'the photo couldn’t be converted for viewing'
          : 'the contents couldn’t be read',
    };
  }

  await writeOutcome(fileId, outcome);
  return outcome.status;
}

/** Batch form, bounded so a multi-file drop doesn't swamp the function. */
export async function ensureVisionArtifacts(fileIds: string[]): Promise<void> {
  const queue = [...new Set(fileIds)];
  const workers = Array.from(
    { length: Math.min(PREP_CONCURRENCY, queue.length) },
    async () => {
      for (;;) {
        const next = queue.shift();
        if (!next) return;
        await ensureVisionArtifact(next);
      }
    },
  );
  await Promise.all(workers);
}

/**
 * Send rows back to 'failed' so the next turn re-uploads them.
 *
 * Called when the Messages API rejects a file_id we thought was live — the
 * file was deleted on Anthropic's side, or the row was uploaded under a
 * different API key (a staging row read by production, say). Clearing the id
 * is what lets ensureVisionArtifact treat it as retryable instead of skipping
 * it forever as 'ready'.
 */
export async function invalidateVisionArtifacts(
  anthropicFileIds: string[],
): Promise<void> {
  if (anthropicFileIds.length === 0) return;
  const supabase = getSupabaseServer();
  const { error } = await supabase
    .from(INBOUND_FILES_TABLE)
    .update({
      vision_status: 'failed',
      anthropic_file_id: null,
      vision_note: 'the attachment needs to be re-loaded',
    })
    .in('anthropic_file_id', anthropicFileIds);
  if (error) {
    console.error('[vision prep] invalidate failed', error);
  }
}

/**
 * Drop the Anthropic-side copy when a staged file is deleted.
 *
 * Anthropic files have no TTL, so without this every chip a user adds and then
 * removes from the composer leaves an orphan against the org's storage quota
 * forever. Best-effort: a failure here is a bit of litter, not a broken delete.
 */
export async function deleteVisionArtifact(fileId: string): Promise<void> {
  const supabase = getSupabaseServer();
  const { data } = await supabase
    .from(INBOUND_FILES_TABLE)
    .select('anthropic_file_id')
    .eq('id', fileId)
    .maybeSingle();

  const anthropicFileId = (data as { anthropic_file_id: string | null } | null)
    ?.anthropic_file_id;
  if (!anthropicFileId) return;

  try {
    await getAnthropic().beta.files.delete(anthropicFileId, {
      headers: { 'anthropic-beta': FILES_BETA },
    } as never);
  } catch (err) {
    console.warn('[vision prep] anthropic file delete failed', {
      fileId,
      anthropicFileId,
      err: err instanceof Error ? err.message : err,
    });
  }
}
