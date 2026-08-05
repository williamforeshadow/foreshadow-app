import { getSupabaseServer } from '@/lib/supabaseServer';
import {
  INBOUND_FILES_BUCKET,
  INBOUND_FILE_COLUMNS,
  INBOUND_FILES_TABLE,
  MAX_INBOUND_BYTES,
  formatInboundFilesForAgent,
  safeName,
  stageInboundFile,
  type InboundFile,
} from '@/src/server/agent/inboundFiles';

// Slack's half of inbound-file staging: pull the bytes off Slack's private
// URLs, then hand them to the shared stager. Everything surface-agnostic —
// the bucket, the row shape, classification, the agent-facing context block —
// lives in src/server/agent/inboundFiles.ts and is shared with the in-app
// chat.

/** @deprecated Import INBOUND_FILES_BUCKET from the agent module instead. */
export const SLACK_INBOUND_BUCKET = INBOUND_FILES_BUCKET;

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

export type CapturedSlackInboundFile = InboundFile;

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

async function downloadSlackFile(file: SlackInboundFileEvent, botToken: string) {
  const url = file.url_private_download || file.url_private;
  if (!url) throw new Error(`Slack file ${file.id} has no private download URL`);
  if (file.size && file.size > MAX_INBOUND_BYTES) {
    throw new Error(`Slack file ${file.name || file.id} exceeds 50MB limit`);
  }
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${botToken}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to download Slack file ${file.id}: ${res.status}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_INBOUND_BYTES) {
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
    const storagePath = [
      'slack',
      args.channelId,
      args.messageTs.replace('.', '-'),
      `${file.id}-${name}`,
    ].join('/');

    // Slack redelivers events; slack_file_id is unique, so a file we already
    // staged is reused instead of downloaded and stored a second time.
    const existing = await supabase
      .from(INBOUND_FILES_TABLE)
      .select(INBOUND_FILE_COLUMNS)
      .eq('slack_file_id', file.id)
      .maybeSingle();
    if (existing.data) {
      captured.push(existing.data as CapturedSlackInboundFile);
      continue;
    }

    const bytes = await downloadSlackFile(file, args.botToken);
    captured.push(
      await stageInboundFile({
        bytes,
        name,
        mimeType: file.mimetype || null,
        title: file.title || null,
        appUserId: args.appUserId,
        source: 'slack',
        storagePath,
        slack: {
          fileId: file.id,
          teamId: args.teamId,
          channelId: args.channelId,
          messageTs: args.messageTs,
          threadTs: args.threadTs,
          userId: args.slackUserId,
        },
      }),
    );
  }

  return captured;
}

/**
 * Slack's carry-forward query. Scoped to the channel (and thread when there is
 * one), not just to the user — uploads in one channel shouldn't surface in
 * another. The web surface has no channel, so it uses listRecentInboundFiles.
 */
export async function listRecentSlackInboundFiles(
  args: ListRecentSlackInboundFilesArgs,
): Promise<CapturedSlackInboundFile[]> {
  const supabase = getSupabaseServer();
  const since = new Date(
    Date.now() - (args.minutes ?? 60) * 60 * 1000,
  ).toISOString();

  let query = supabase
    .from(INBOUND_FILES_TABLE)
    .select(INBOUND_FILE_COLUMNS)
    .eq('app_user_id', args.appUserId)
    .eq('source', 'slack')
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
  return formatInboundFilesForAgent(files, 'slack');
}
