import type { ImageBlockParam } from '@anthropic-ai/sdk/resources/messages';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { GUEST_MESSAGE_ATTACHMENT_BUCKET } from './attachments';
import type { GuestMessageRecord, MessageAttachment } from '@/lib/messages';

// Guest photos, turned into something the Concierge can actually see.
//
// Attachments are captured at ingest into a PRIVATE bucket and stored on the
// message as a jsonb array holding a storage PATH (see attachments.ts). The
// draft prompt only ever rendered `body` text, so a guest who sent a photo of a
// broken heater with no caption arrived at the model as "Guest: (no text)" — and
// the reply read like nothing had been sent, which is exactly what an operator
// notices.
//
// Two decisions worth stating:
//
// BASE64, NOT URL. The Messages API accepts a `url` source, and the bucket can
// mint a signed URL — but that makes the draft depend on Anthropic fetching a
// short-lived URL from our storage host mid-request, adding an expiry window and
// a network hop that fails in a way we can't see. We already have service-role
// read access, so we send the bytes.
//
// IMAGES FIRST, THEN TEXT. Anthropic's guidance is that images placed before
// text outperform images after or interleaved with it, and that multiple images
// should each be introduced with a short label. So the user turn is built as
// "Image 1:" <image> "Image 2:" <image> … then the whole reservation + transcript
// block, and the transcript marks which message carried which image. That keeps
// chronology legible without interleaving.

/** The only formats the Messages API accepts. Anything else must not be sent. */
const SUPPORTED_MEDIA_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

/**
 * How many images ride along with one draft. The guest's most recent photos are
 * the ones a reply is actually about; older ones are context the transcript
 * already describes in words. Also keeps the request comfortably under the 32MB
 * body limit and away from the >20-image rule that tightens per-image dimensions.
 */
const MAX_IMAGES = 4;

/**
 * Skip anything whose base64 form would exceed the API's 10MB per-image ceiling.
 * Base64 inflates by 4/3, so 7MB of raw bytes is the practical cutoff. The bucket
 * itself allows 25MB, so this genuinely triggers on large photos.
 */
const MAX_RAW_BYTES = 7 * 1024 * 1024;

export interface ConciergeImage {
  /** 1-based label the transcript and the content blocks agree on. */
  label: number;
  messageId: string;
  block: ImageBlockParam;
}

export interface ConciergeImageLoad {
  images: ConciergeImage[];
  /**
   * Per message id, the human-readable attachment note for the transcript line —
   * e.g. "sent Image 1" or "sent a file: lease.pdf". Present for every message
   * that HAS attachments, including ones we couldn't send, so the model is never
   * left thinking a photo-only message was empty.
   */
  notesByMessageId: Map<string, string>;
}

const EMPTY: ConciergeImageLoad = { images: [], notesByMessageId: new Map() };

function isSendableImage(att: MessageAttachment): boolean {
  if (att.file_type !== 'image') return false;
  if (!att.mime_type || !SUPPORTED_MEDIA_TYPES.has(att.mime_type)) return false;
  if (att.size_bytes != null && att.size_bytes > MAX_RAW_BYTES) return false;
  return true;
}

/** What to call an attachment we can't send, so the transcript still accounts for it. */
function describeUnsendable(att: MessageAttachment): string {
  if (att.file_type === 'image') {
    // Most often an iPhone HEIC, or a photo too large to inline.
    return `sent a photo we can't display (${att.name})`;
  }
  if (att.file_type === 'video') return `sent a video (${att.name})`;
  return `sent a file (${att.name})`;
}

/**
 * Load the sendable images from a thread as content blocks, newest-first-priority
 * but returned in conversation order.
 *
 * Never throws — a draft with no images is worse than one with them, but far
 * better than no draft at all. Every failure degrades to a transcript note.
 */
export async function loadConciergeImages(
  messages: GuestMessageRecord[],
): Promise<ConciergeImageLoad> {
  const withAttachments = messages.filter((m) => (m.attachments?.length ?? 0) > 0);
  if (withAttachments.length === 0) return EMPTY;

  // Walk newest-first so the cap keeps the most recent photos, then restore
  // conversation order — the labels must read in the same direction as the
  // transcript or "Image 1" points at the wrong message.
  const candidates: Array<{ messageId: string; att: MessageAttachment }> = [];
  const unsendableByMessage = new Map<string, string[]>();

  for (const m of [...withAttachments].reverse()) {
    for (const att of m.attachments ?? []) {
      if (isSendableImage(att) && candidates.length < MAX_IMAGES) {
        candidates.push({ messageId: m.id, att });
      } else {
        const list = unsendableByMessage.get(m.id) ?? [];
        list.push(describeUnsendable(att));
        unsendableByMessage.set(m.id, list);
      }
    }
  }
  candidates.reverse();

  const supabase = getSupabaseServer();
  const images: ConciergeImage[] = [];
  const sentLabelsByMessage = new Map<string, number[]>();

  for (const { messageId, att } of candidates) {
    try {
      const { data, error } = await supabase.storage
        .from(GUEST_MESSAGE_ATTACHMENT_BUCKET)
        .download(att.storage_path);
      if (error || !data) throw new Error(error?.message ?? 'no data');

      const bytes = Buffer.from(await data.arrayBuffer());
      // Re-check against the real bytes: size_bytes is what the channel reported
      // at ingest and can be absent or wrong.
      if (bytes.byteLength > MAX_RAW_BYTES) {
        const list = unsendableByMessage.get(messageId) ?? [];
        list.push(describeUnsendable(att));
        unsendableByMessage.set(messageId, list);
        continue;
      }

      const label = images.length + 1;
      images.push({
        label,
        messageId,
        block: {
          type: 'image',
          source: {
            type: 'base64',
            media_type: att.mime_type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
            data: bytes.toString('base64'),
          },
        },
      });
      const labels = sentLabelsByMessage.get(messageId) ?? [];
      labels.push(label);
      sentLabelsByMessage.set(messageId, labels);
    } catch (err) {
      console.error('[concierge images] load failed', {
        storage_path: att.storage_path,
        err: err instanceof Error ? err.message : err,
      });
      const list = unsendableByMessage.get(messageId) ?? [];
      list.push(describeUnsendable(att));
      unsendableByMessage.set(messageId, list);
    }
  }

  // One note per message, merging what we sent with what we couldn't.
  const notesByMessageId = new Map<string, string>();
  const messageIds = new Set([...sentLabelsByMessage.keys(), ...unsendableByMessage.keys()]);
  for (const id of messageIds) {
    const parts: string[] = [];
    const labels = sentLabelsByMessage.get(id);
    if (labels?.length) {
      parts.push(`sent ${labels.map((n) => `Image ${n}`).join(' and ')}`);
    }
    const others = unsendableByMessage.get(id);
    if (others?.length) parts.push(...others);
    notesByMessageId.set(id, parts.join('; '));
  }

  return { images, notesByMessageId };
}
