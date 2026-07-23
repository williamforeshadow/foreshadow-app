import { getSupabaseServer } from '@/lib/supabaseServer';
import type {
  AttachmentFileType,
  MessageAttachment,
  RawMessageAttachment,
} from '@/lib/messages';

// Re-host conversation attachments so they outlive Hostaway's presigned URLs.
//
// Hostaway hands each attachment a presigned S3 URL that works now but expires
// within the hour (its sibling `imagesUrls` field 403s outright). So a stored
// URL is worthless — instead we download the bytes at ingest and upload them to
// our own private bucket, then persist only the storage PATH on the message.
// The read route mints a fresh signed URL per view. From capture onward the
// file is ours and lives as long as the message.
//
// This is the display half of Phase 1: it captures what guests/hosts send in.
// Sending attachments FROM the app is a separate, not-yet-built path.

export const GUEST_MESSAGE_ATTACHMENT_BUCKET = 'guest-message-attachments';
const MAX_BYTES = 25 * 1024 * 1024;

// A message that carried at least one attachment through the mapper. This is the
// slice of RawGuestMessage capture needs — it doesn't touch body/direction.
export interface MessageAttachmentSource {
  hostawayMessageId: string;
  hostawayConversationId: string;
  attachments: RawMessageAttachment[];
}

function classifyFileType(
  mimeType: string | null,
  extension: string | null,
): AttachmentFileType {
  if (mimeType?.startsWith('image/')) return 'image';
  if (mimeType?.startsWith('video/')) return 'video';
  const ext = (extension ?? '').toLowerCase();
  if (
    mimeType === 'application/pdf' ||
    mimeType === 'application/msword' ||
    mimeType?.startsWith('application/vnd.') ||
    mimeType === 'text/csv' ||
    mimeType === 'text/plain' ||
    ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt'].includes(ext)
  ) {
    return 'document';
  }
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif'].includes(ext)) return 'image';
  return 'other';
}

// Storage keys must be ASCII-ish and bounded; guest filenames are neither.
function safeName(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'attachment';
}

async function downloadAttachment(att: RawMessageAttachment): Promise<ArrayBuffer> {
  if (att.sizeBytes != null && att.sizeBytes > MAX_BYTES) {
    throw new Error(`attachment ${att.hostawayAttachmentId} exceeds ${MAX_BYTES} bytes`);
  }
  const res = await fetch(att.url);
  if (!res.ok) {
    throw new Error(`download failed (${res.status}) for attachment ${att.hostawayAttachmentId}`);
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) {
    throw new Error(`attachment ${att.hostawayAttachmentId} exceeds ${MAX_BYTES} bytes`);
  }
  return buf;
}

/**
 * Download + re-host every attachment on the given messages, then write the
 * resulting records onto each guest_messages row's `attachments` jsonb.
 *
 * Idempotent: a message's already-captured attachments (matched by Hostaway
 * attachment id) are left untouched, so re-ingest — which happens on every sync
 * and every post-send re-pull — never re-downloads. Best-effort throughout: a
 * single failed download logs and is skipped rather than failing the message or
 * the surrounding sync. Returns the number of newly captured files.
 */
export async function captureMessageAttachments(
  orgId: string,
  sources: MessageAttachmentSource[],
): Promise<number> {
  const withAny = sources.filter((s) => s.attachments.length > 0);
  if (withAny.length === 0) return 0;

  const supabase = getSupabaseServer();
  let captured = 0;

  for (const src of withAny) {
    // The message row is upserted before capture runs; look it up by the unique
    // (org_id, hostaway_message_id) key to get its id and what's already stored.
    const { data: row, error: rowErr } = await supabase
      .from('guest_messages')
      .select('id, attachments')
      .eq('org_id', orgId)
      .eq('hostaway_message_id', src.hostawayMessageId)
      .maybeSingle();
    if (rowErr || !row) {
      if (rowErr) console.error('[message attachments] row lookup failed', rowErr.message);
      continue;
    }

    const existing = (((row as { attachments: unknown }).attachments as
      | MessageAttachment[]
      | null) ?? []).filter((a) => a && typeof a === 'object');
    const alreadyStored = new Set(existing.map((a) => a.hostaway_attachment_id));

    const fresh: MessageAttachment[] = [];
    for (const att of src.attachments) {
      if (alreadyStored.has(att.hostawayAttachmentId)) continue;

      const name = safeName(att.name);
      const storagePath = [
        'org',
        orgId,
        'conv',
        src.hostawayConversationId,
        'msg',
        src.hostawayMessageId,
        `${att.hostawayAttachmentId}-${name}`,
      ].join('/');

      try {
        const bytes = await downloadAttachment(att);
        const { error: uploadErr } = await supabase.storage
          .from(GUEST_MESSAGE_ATTACHMENT_BUCKET)
          .upload(storagePath, bytes, {
            contentType: att.mimeType || 'application/octet-stream',
            upsert: true, // re-runs after a partial failure overwrite, not duplicate
          });
        if (uploadErr) throw new Error(uploadErr.message);

        fresh.push({
          hostaway_attachment_id: att.hostawayAttachmentId,
          name: att.name,
          mime_type: att.mimeType,
          file_type: classifyFileType(att.mimeType, att.extension),
          size_bytes: att.sizeBytes ?? bytes.byteLength,
          storage_path: storagePath,
        });
      } catch (err) {
        console.error(
          `[message attachments] capture skipped for ${att.hostawayAttachmentId}`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    if (fresh.length === 0) continue;

    const { error: updateErr } = await supabase
      .from('guest_messages')
      .update({ attachments: [...existing, ...fresh] })
      .eq('id', (row as { id: string }).id);
    if (updateErr) {
      console.error('[message attachments] jsonb update failed', updateErr.message);
      continue;
    }
    captured += fresh.length;
  }

  return captured;
}
