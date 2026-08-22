import type { BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta/messages';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { INBOUND_FILES_TABLE, type InboundFile } from './inboundFiles';

// Staged files -> content blocks the model can actually look at.
//
// The write side (inboundFileVisionPrep.ts) already resolved each file to one
// canonical artifact. This module's job is narrower: pick which of them ride
// along on a given turn, in what order, and under what label — and produce an
// honest sentence for every one that can't come.
//
// It never throws and it never blocks a turn. The worst case is a turn where
// the agent has metadata and says so.

/**
 * What rides along on one turn.
 *
 * Sized by files and tokens rather than by conversation turns, because turns
 * are the wrong axis: one photo followed by nine questions about it should keep
 * the photo, while twenty screenshots should not sit in every request forever.
 * For any realistic ops conversation these caps mean "everything" — nobody
 * sends twelve attachments to a task agent — while still refusing to run away.
 */
export const MEDIA_LIMITS = {
  maxFiles: 12,
  /**
   * Sized so twelve images at the pessimistic per-image estimate below still
   * fit — otherwise the token budget silently binds first and the real cap is
   * ~10, not the 12 this claims. Images are the common case and should be
   * governed by maxFiles; this budget is the backstop for the things that vary
   * wildly in size, which is PDFs and extracted text.
   */
  maxMediaTokens: 60_000,
  /** Per text document. Beyond this the model gets a labelled prefix. */
  maxTextChars: 40_000,
} as const;

/**
 * Rough per-artifact token costs, used only to decide what fits.
 *
 * Deliberately pessimistic. These bound a budget, they don't bill anyone, and
 * over-estimating drops one borderline attachment while under-estimating puts
 * an unbounded document into every request for the rest of the conversation.
 */
const IMAGE_TOKEN_ESTIMATE = 4_800; // Sonnet 5 high-res ceiling per image
const PDF_TOKENS_PER_MB = 12_000; // pages bill as text AND image

export interface RenderedInboundFile {
  fileId: string;
  name: string;
  /** Shared 1-based counter, so "Image 3" means one thing per conversation. */
  label: number | null;
  visible: boolean;
  /** The `visible:` clause for this file's line in the context block. */
  note: string;
}

export interface InboundMediaRender {
  /** Flattened, in file order. Callers place these BEFORE the turn's text. */
  blocks: BetaContentBlockParam[];
  files: RenderedInboundFile[];
  visibleIds: string[];
  /** Next free label, so a later render continues the numbering. */
  nextLabel: number;
}

export const EMPTY_RENDER: InboundMediaRender = {
  blocks: [],
  files: [],
  visibleIds: [],
  nextLabel: 1,
};

export interface RenderOptions {
  startLabel?: number;
  maxFiles?: number;
  maxMediaTokens?: number;
  maxTextChars?: number;
}

function estimateTokens(file: InboundFile, textLength: number): number {
  if (file.vision_status === 'ready') {
    if (file.vision_media_type === 'application/pdf') {
      const mb = (file.size_bytes ?? 0) / (1024 * 1024);
      return Math.max(2_000, Math.round(mb * PDF_TOKENS_PER_MB));
    }
    return IMAGE_TOKEN_ESTIMATE;
  }
  if (file.vision_status === 'text') return Math.ceil(textLength / 4);
  return 0;
}

/** Why a file isn't coming along, phrased for the agent to repeat verbatim. */
function invisibleNote(file: InboundFile): string {
  if (file.vision_note) return file.vision_note;
  if (file.vision_status === 'failed') return 'the contents couldn’t be read';
  if (file.file_type === 'video') return 'video can’t be viewed';
  return 'this file type can’t be opened';
}

/**
 * Fetch the extracted text for the handful of files that need it.
 *
 * Kept out of INBOUND_FILE_COLUMNS on purpose — vision_text can hold 200KB and
 * the carry-forward query lists rows on every single turn. Here we know exactly
 * which ids we're about to render.
 */
async function loadVisionText(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from(INBOUND_FILES_TABLE)
    .select('id, vision_text')
    .in('id', ids);
  if (error) {
    console.error('[inbound vision] text load failed', error);
    return out;
  }
  for (const row of (data ?? []) as Array<{ id: string; vision_text: string | null }>) {
    if (row.vision_text) out.set(row.id, row.vision_text);
  }
  return out;
}

/**
 * Prepare anything not yet resolved, then re-read just those rows.
 *
 * This is what makes staging-time prep an optimisation rather than a
 * correctness requirement — and what silently backfills every file staged
 * before vision existed. The prep module is imported lazily so its WASM and
 * document-parsing dependencies stay out of the module graph of every turn
 * that doesn't need them.
 */
async function resolvePending(files: InboundFile[]): Promise<InboundFile[]> {
  const pending = files.filter(
    (f) => f.vision_status === 'pending' || f.vision_status === 'failed',
  );
  if (pending.length === 0) return files;

  try {
    const { ensureVisionArtifacts } = await import('./inboundFileVisionPrep');
    await ensureVisionArtifacts(pending.map((f) => f.id));
  } catch (err) {
    console.error('[inbound vision] lazy prep failed', err);
    return files;
  }

  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from(INBOUND_FILES_TABLE)
    .select('id, vision_status, anthropic_file_id, vision_media_type, vision_note')
    .in(
      'id',
      pending.map((f) => f.id),
    );
  if (error) {
    console.error('[inbound vision] refresh after prep failed', error);
    return files;
  }

  const refreshed = new Map(
    ((data ?? []) as Array<Partial<InboundFile> & { id: string }>).map((r) => [
      r.id,
      r,
    ]),
  );
  return files.map((f) => {
    const patch = refreshed.get(f.id);
    return patch ? { ...f, ...patch } : f;
  });
}

/**
 * Turn staged files into content blocks, newest-first under the caps but
 * returned in conversation order.
 *
 * Order matters twice over. Within the returned array, media comes before the
 * turn's text because images ahead of text outperform images after or
 * interleaved with them. Across the array, files read oldest to newest so
 * "Image 1" is the first thing the user sent, not the last.
 */
export async function renderInboundFilesAsMedia(
  files: InboundFile[],
  opts: RenderOptions = {},
): Promise<InboundMediaRender> {
  const startLabel = opts.startLabel ?? 1;
  if (files.length === 0) {
    return { ...EMPTY_RENDER, nextLabel: startLabel };
  }

  const maxFiles = opts.maxFiles ?? MEDIA_LIMITS.maxFiles;
  const maxTokens = opts.maxMediaTokens ?? MEDIA_LIMITS.maxMediaTokens;
  const maxTextChars = opts.maxTextChars ?? MEDIA_LIMITS.maxTextChars;

  const resolved = await resolvePending(files);
  const textById = await loadVisionText(
    resolved.filter((f) => f.vision_status === 'text').map((f) => f.id),
  );

  // Walk newest-first so the cap keeps the most recent attachments — those are
  // the ones a question is usually about — then restore conversation order so
  // the labels read forward.
  const admitted = new Set<string>();
  let budget = maxTokens;
  let count = 0;
  for (const file of [...resolved].reverse()) {
    // A 'ready' row is renderable either via an anthropic_file_id (Anthropic
    // path) or by inlining base64 from storage (OpenAI path, no upload). Text
    // rows are renderable once their extracted text has loaded.
    const renderable =
      file.vision_status === 'ready'
        ? true
        : file.vision_status === 'text' && textById.has(file.id);
    if (!renderable) continue;

    const text = textById.get(file.id) ?? '';
    const clipped = text.length > maxTextChars ? maxTextChars : text.length;
    const cost = estimateTokens(file, clipped);
    if (count >= maxFiles || cost > budget) continue;

    admitted.add(file.id);
    budget -= cost;
    count += 1;
  }

  const blocks: BetaContentBlockParam[] = [];
  const rendered: RenderedInboundFile[] = [];
  const visibleIds: string[] = [];
  let label = startLabel;

  for (const file of resolved) {
    if (!admitted.has(file.id)) {
      rendered.push({
        fileId: file.id,
        name: file.name,
        label: null,
        visible: false,
        note:
          file.vision_status === 'ready' || file.vision_status === 'text'
            ? 'not shown this turn — too many attachments in view'
            : invisibleNote(file),
      });
      continue;
    }

    if (file.vision_status === 'ready') {
      const isPdf = file.vision_media_type === 'application/pdf';

      if (file.anthropic_file_id) {
        // Anthropic path: reference the uploaded file by id (resolved to a
        // data URL on the OpenAI translation path).
        blocks.push(
          isPdf
            ? {
                type: 'document',
                source: { type: 'file', file_id: file.anthropic_file_id },
                title: file.name,
              }
            : {
                type: 'image',
                source: { type: 'file', file_id: file.anthropic_file_id },
              },
        );
      } else {
        // No Anthropic upload (OpenAI provider): inline base64 straight from
        // storage. A base64 source is provider-agnostic — both APIs accept it —
        // so this block is safe even if the provider later flips. Imported
        // lazily to keep the prep module's sharp/heic deps out of turns that
        // don't render media.
        const { loadRenderableByInboundFileId } = await import(
          './inboundFileVisionPrep'
        );
        const inline = await loadRenderableByInboundFileId(file.id);
        if (!inline) {
          rendered.push({
            fileId: file.id,
            name: file.name,
            label: null,
            visible: false,
            note: 'the contents couldn’t be read',
          });
          continue;
        }
        blocks.push(
          inline.kind === 'pdf'
            ? {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: inline.base64,
                },
                title: file.name,
              }
            : {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: inline.mediaType as
                    | 'image/jpeg'
                    | 'image/png'
                    | 'image/gif'
                    | 'image/webp',
                  data: inline.base64,
                },
              },
        );
      }

      rendered.push({
        fileId: file.id,
        name: file.name,
        label,
        visible: true,
        note: `${isPdf ? 'Document' : 'Image'} ${label}`,
      });
      visibleIds.push(file.id);
      label += 1;
      continue;
    }

    // Extracted text. The truncation marker goes INSIDE the data, not only in
    // the metadata line — the model has to see the boundary in the same place
    // it sees the content, or it summarises a partial file as a whole one.
    const full = textById.get(file.id) ?? '';
    const truncated = full.length > maxTextChars;
    const body = truncated
      ? `${full.slice(0, maxTextChars)}\n\n[TRUNCATED — showing the first ${maxTextChars.toLocaleString()} of ${full.length.toLocaleString()} characters of "${file.name}".]`
      : full;

    blocks.push({
      type: 'document',
      source: { type: 'text', media_type: 'text/plain', data: body },
      title: file.name,
    });
    rendered.push({
      fileId: file.id,
      name: file.name,
      label,
      visible: true,
      note: `Document ${label}${truncated ? ', truncated' : ''}`,
    });
    visibleIds.push(file.id);
    label += 1;
  }

  return { blocks, files: rendered, visibleIds, nextLabel: label };
}
