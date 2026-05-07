import { getSupabaseServer } from '@/lib/supabaseServer';

export const SLACK_INBOUND_BUCKET = 'slack-inbound-files';
const MAX_BYTES = 50 * 1024 * 1024;

export interface SlackInboundFileEvent {
  id: string;
  name?: string;
  title?: string;
  mimetype?: string;
  filetype?: string;
  size?: number;
  url_private?: string;
  url_private_download?: string;
}

export interface CapturedSlackInboundFile {
  id: string;
  slack_file_id: string;
  name: string;
  title: string | null;
  mime_type: string | null;
  file_type: 'image' | 'video' | 'document' | 'other';
  size_bytes: number | null;
  storage_bucket: string;
  storage_path: string;
}

export interface CaptureSlackFilesArgs {
  files: SlackInboundFileEvent[];
  botToken: string;
  teamId?: string;
  channelId: string;
  messageTs: string;
  threadTs?: string;
  slackUserId: string;
  appUserId: string;
}

export interface ListRecentSlackInboundFilesArgs {
  appUserId: string;
  channelId: string;
  threadTs?: string;
  minutes?: number;
  limit?: number;
}

function classifyFile(mimeType: string | null, name: string) {
  if (mimeType?.startsWith('image/')) return 'image' as const;
  if (mimeType?.startsWith('video/')) return 'video' as const;
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
    return 'document' as const;
  }
  return 'other' as const;
}

function safeName(raw: string) {
  return raw.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || 'slack-file';
}

async function downloadSlackFile(file: SlackInboundFileEvent, botToken: string) {
  const url = file.url_private_download || file.url_private;
  if (!url) throw new Error(`Slack file ${file.id} has no private download URL`);
  if (file.size && file.size > MAX_BYTES) {
    throw new Error(`Slack file ${file.name || file.id} exceeds 50MB limit`);
  }
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${botToken}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to download Slack file ${file.id}: ${res.status}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_BYTES) {
    throw new Error(`Slack file ${file.name || file.id} exceeds 50MB limit`);
  }
  return arrayBuffer;
}

export async function captureSlackInboundFiles(
  args: CaptureSlackFilesArgs,
): Promise<CapturedSlackInboundFile[]> {
  if (args.files.length === 0) return [];
  const supabase = getSupabaseServer();
  const captured: CapturedSlackInboundFile[] = [];

  for (const file of args.files) {
    const name = safeName(file.name || `${file.id}.bin`);
    const mimeType = file.mimetype || null;
    const fileType = classifyFile(mimeType, name);
    const storagePath = [
      'slack',
      args.channelId,
      args.messageTs.replace('.', '-'),
      `${file.id}-${name}`,
    ].join('/');

    const existing = await supabase
      .from('slack_inbound_files')
      .select(
        'id, slack_file_id, name, title, mime_type, file_type, size_bytes, storage_bucket, storage_path',
      )
      .eq('slack_file_id', file.id)
      .maybeSingle();
    if (existing.data) {
      captured.push(existing.data as CapturedSlackInboundFile);
      continue;
    }

    const bytes = await downloadSlackFile(file, args.botToken);
    const { error: uploadError } = await supabase.storage
      .from(SLACK_INBOUND_BUCKET)
      .upload(storagePath, bytes, {
        contentType: mimeType || 'application/octet-stream',
        upsert: false,
      });
    if (uploadError) throw new Error(uploadError.message);

    const { data, error } = await supabase
      .from('slack_inbound_files')
      .insert({
        slack_file_id: file.id,
        slack_team_id: args.teamId ?? null,
        slack_channel_id: args.channelId,
        slack_message_ts: args.messageTs,
        slack_thread_ts: args.threadTs ?? null,
        slack_user_id: args.slackUserId,
        app_user_id: args.appUserId,
        storage_bucket: SLACK_INBOUND_BUCKET,
        storage_path: storagePath,
        name,
        title: file.title || null,
        mime_type: mimeType,
        file_type: fileType,
        size_bytes: file.size ?? bytes.byteLength,
      })
      .select(
        'id, slack_file_id, name, title, mime_type, file_type, size_bytes, storage_bucket, storage_path',
      )
      .maybeSingle();

    if (error || !data) {
      await supabase.storage.from(SLACK_INBOUND_BUCKET).remove([storagePath]);
      throw new Error(error?.message || 'Failed to record Slack inbound file');
    }
    captured.push(data as CapturedSlackInboundFile);
  }

  return captured;
}

export async function listRecentSlackInboundFiles(
  args: ListRecentSlackInboundFilesArgs,
): Promise<CapturedSlackInboundFile[]> {
  const supabase = getSupabaseServer();
  const since = new Date(
    Date.now() - (args.minutes ?? 60) * 60 * 1000,
  ).toISOString();

  let query = supabase
    .from('slack_inbound_files')
    .select(
      'id, slack_file_id, name, title, mime_type, file_type, size_bytes, storage_bucket, storage_path',
    )
    .eq('app_user_id', args.appUserId)
    .eq('slack_channel_id', args.channelId)
    .is('consumed_at', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(args.limit ?? 10);

  if (args.threadTs) {
    query = query.eq('slack_thread_ts', args.threadTs);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[slack inbound files] recent query failed', error);
    return [];
  }
  return (data ?? []) as CapturedSlackInboundFile[];
}

export function formatSlackInboundFilesForAgent(
  files: CapturedSlackInboundFile[],
): string | null {
  if (files.length === 0) return null;
  const lines = files.map((file, index) => {
    const size =
      file.size_bytes == null
        ? 'unknown size'
        : `${(file.size_bytes / 1024 / 1024).toFixed(2)} MB`;
    return `${index + 1}. inbound_file_id=${file.id}; name="${file.name}"; type=${file.file_type}; mime=${file.mime_type || 'unknown'}; size=${size}`;
  });
  return [
    'Slack uploaded files available for this conversation:',
    ...lines,
    'Use these inbound_file_id values directly with preview_slack_file_attachment. Never ask the user to provide inbound file IDs; they cannot see them. If the user confirms a task creation and file attachment in a later message, these files are still available here until consumed. Do not claim a file was attached unless the matching commit tool succeeds.',
  ].join('\n');
}
