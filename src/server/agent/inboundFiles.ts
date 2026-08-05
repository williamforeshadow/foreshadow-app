import { getSupabaseServer } from '@/lib/supabaseServer';

// Inbound-file staging, shared by every surface that can hand the agent a
// binary.
//
// The agent never receives file bytes. A file is uploaded once into a private
// staging bucket, recorded as a row, and from then on the model only ever sees
// its `inbound_file_id` — an opaque handle it passes to
// preview_file_attachment to file the thing somewhere real. The commit side
// (src/server/slack/attachInboundFile.ts) reads the bytes back out.
//
// Slack got here first, which is why the bucket and table still carry its
// name. `source` is what actually distinguishes the two paths now.

export const INBOUND_FILES_BUCKET = 'slack-inbound-files';
export const INBOUND_FILES_TABLE = 'slack_inbound_files';

/** Ceiling for a single staged file. Matches the bucket's file_size_limit. */
export const MAX_INBOUND_BYTES = 50 * 1024 * 1024;

/** Which surface staged the file. Persisted in the `source` column. */
export type InboundFileSource = 'slack' | 'web';

export type InboundFileType = 'image' | 'video' | 'document' | 'other';

export interface InboundFile {
  id: string;
  slack_file_id: string | null;
  name: string;
  title: string | null;
  mime_type: string | null;
  file_type: InboundFileType;
  size_bytes: number | null;
  storage_bucket: string;
  storage_path: string;
}

/** The column list every read in this module selects. */
export const INBOUND_FILE_COLUMNS =
  'id, slack_file_id, name, title, mime_type, file_type, size_bytes, storage_bucket, storage_path';

/**
 * Bucket a file into the four coarse types the destination tables understand.
 *
 * Deliberately permissive: an unrecognised type lands in 'other' rather than
 * being rejected. Staging accepts anything the user can pick — it's the
 * destination that has opinions (photo targets require an image, for example).
 */
export function classifyFile(
  mimeType: string | null,
  name: string,
): InboundFileType {
  if (mimeType?.startsWith('image/')) return 'image';
  if (mimeType?.startsWith('video/')) return 'video';
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  if (
    mimeType === 'application/pdf' ||
    mimeType === 'application/msword' ||
    mimeType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/vnd.ms-excel' ||
    mimeType ===
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimeType === 'text/csv' ||
    mimeType === 'text/plain' ||
    ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt'].includes(extension)
  ) {
    return 'document';
  }
  return 'other';
}

export function safeName(raw: string) {
  return raw.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || 'upload';
}

export interface StageInboundFileArgs {
  bytes: ArrayBuffer;
  /** Original filename as the user knows it. Stored verbatim; sanitised for the path. */
  name: string;
  mimeType: string | null;
  title?: string | null;
  appUserId: string;
  source: InboundFileSource;
  /** Storage key within the staging bucket. Callers namespace their own rows. */
  storagePath: string;
  /** Slack provenance. Required when source is 'slack', absent otherwise. */
  slack?: {
    fileId: string;
    teamId?: string;
    channelId: string;
    messageTs: string;
    threadTs?: string;
    userId: string;
  };
}

/**
 * Upload bytes into the staging bucket and record the row.
 *
 * Storage and the table are written as a pair: if the insert fails the object
 * is removed again, so a staged file is never orphaned without a row pointing
 * at it. org_id is derived from app_user_id by a database trigger.
 */
export async function stageInboundFile(
  args: StageInboundFileArgs,
): Promise<InboundFile> {
  const supabase = getSupabaseServer();
  const mimeType = args.mimeType || null;

  const { error: uploadError } = await supabase.storage
    .from(INBOUND_FILES_BUCKET)
    .upload(args.storagePath, args.bytes, {
      contentType: mimeType || 'application/octet-stream',
      upsert: false,
    });
  if (uploadError) throw new Error(uploadError.message);

  const { data, error } = await supabase
    .from(INBOUND_FILES_TABLE)
    .insert({
      source: args.source,
      slack_file_id: args.slack?.fileId ?? null,
      slack_team_id: args.slack?.teamId ?? null,
      slack_channel_id: args.slack?.channelId ?? null,
      slack_message_ts: args.slack?.messageTs ?? null,
      slack_thread_ts: args.slack?.threadTs ?? null,
      slack_user_id: args.slack?.userId ?? null,
      app_user_id: args.appUserId,
      storage_bucket: INBOUND_FILES_BUCKET,
      storage_path: args.storagePath,
      name: args.name,
      title: args.title ?? null,
      mime_type: mimeType,
      file_type: classifyFile(mimeType, args.name),
      size_bytes: args.bytes.byteLength,
    })
    .select(INBOUND_FILE_COLUMNS)
    .maybeSingle();

  if (error || !data) {
    await supabase.storage.from(INBOUND_FILES_BUCKET).remove([args.storagePath]);
    throw new Error(error?.message || 'Failed to record inbound file');
  }
  return data as InboundFile;
}

export interface ListInboundFilesArgs {
  appUserId: string;
  source: InboundFileSource;
  /** How far back to look. Defaults to an hour, matching the Slack surface. */
  minutes?: number;
  limit?: number;
}

/**
 * The caller's still-unconsumed uploads from the recent past.
 *
 * This is what makes "actually, put it on the Maple task instead" work a
 * message later: each turn re-lists the files the user has staged but not yet
 * filed anywhere, so the handles stay live until something consumes them.
 */
export async function listRecentInboundFiles(
  args: ListInboundFilesArgs,
): Promise<InboundFile[]> {
  const supabase = getSupabaseServer();
  const since = new Date(
    Date.now() - (args.minutes ?? 60) * 60 * 1000,
  ).toISOString();

  const { data, error } = await supabase
    .from(INBOUND_FILES_TABLE)
    .select(INBOUND_FILE_COLUMNS)
    .eq('app_user_id', args.appUserId)
    .eq('source', args.source)
    .is('consumed_at', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(args.limit ?? 10);

  if (error) {
    console.error('[inbound files] recent query failed', error);
    return [];
  }
  return (data ?? []) as InboundFile[];
}

/**
 * Load specific staged files, scoped to their owner.
 *
 * The ids come from the client, so ownership is re-checked here rather than
 * trusted — a user may only reference files they staged themselves.
 */
export async function loadInboundFilesForUser(args: {
  ids: string[];
  appUserId: string;
  source: InboundFileSource;
}): Promise<InboundFile[]> {
  if (args.ids.length === 0) return [];
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from(INBOUND_FILES_TABLE)
    .select(INBOUND_FILE_COLUMNS)
    .in('id', args.ids)
    .eq('app_user_id', args.appUserId)
    .eq('source', args.source)
    .is('consumed_at', null);

  if (error) {
    console.error('[inbound files] load by id failed', error);
    return [];
  }
  return (data ?? []) as InboundFile[];
}

/**
 * Render staged files as the context block the model reads.
 *
 * Plain text on purpose — the model gets handles and metadata, never bytes.
 * `where` names the surface the user uploaded from so the prompt reads
 * naturally on both ("Slack uploaded files" / "Uploaded files").
 */
export function formatInboundFilesForAgent(
  files: InboundFile[],
  where: 'slack' | 'web' = 'web',
): string | null {
  if (files.length === 0) return null;
  const lines = files.map((file, index) => {
    const size =
      file.size_bytes == null
        ? 'unknown size'
        : `${(file.size_bytes / 1024 / 1024).toFixed(2)} MB`;
    return `${index + 1}. inbound_file_id=${file.id}; name="${file.name}"; type=${file.file_type}; mime=${file.mime_type || 'unknown'}; size=${size}`;
  });
  const heading =
    where === 'slack'
      ? 'Slack uploaded files available for this conversation:'
      : 'Files the user has uploaded in this chat:';
  return [
    heading,
    ...lines,
    'Use these inbound_file_id values directly with preview_file_attachment. Never ask the user to provide inbound file IDs; they cannot see them. If the user confirms a task creation and file attachment in a later message, these files are still available here until consumed. Do not claim a file was attached unless the matching commit tool succeeds.',
  ].join('\n');
}
