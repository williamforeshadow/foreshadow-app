import { after } from 'next/server';
import { getHostawayCredsForOrg } from '@/lib/pmsIntegrations';
import { sendHostawayMessage } from '@/lib/hostaway';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { ingestConversation } from '@/src/server/messages/ingest';
import { hostawayDateToUtcIso } from '@/lib/messages';
import { canonicalChannelKey } from '@/lib/bookingChannel';

// The one place a guest message actually leaves the building.
//
// Extracted from POST /api/messages/[conversationId]/send so that a send no
// longer requires a browser session. Two callers now:
//
//   HUMAN — the inbox composer / proposed-reply Send button. The route does the
//   RLS-governed authorization read first (another org's id reads as absent →
//   404), then delegates here.
//
//   AUTO  — the auto-send cron tick, which has no session at all. It runs on the
//   service client under the shared cron secret and calls this directly.
//
// Everything below the authorization boundary is identical for both, which is
// the point: an auto-send must not be able to take a different code path to the
// guest than the one a human send is tested on. The ONLY difference is `actor`,
// which is recorded on the message so the thread can say who spoke.
//
// Errors are returned as typed codes rather than thrown — the route maps them to
// the HTTP statuses it always returned, and the cron maps them to a `failed` row
// in concierge_auto_sends. Neither should be parsing error strings.

/** Who is sending. Recorded on guest_messages.sent_via. */
export type SendActor = { type: 'human'; userId: string | null } | { type: 'auto' };

export type SendGuestMessageResult =
  | { ok: true; messageId: string | null; sentAt: string }
  | { ok: false; code: SendFailureCode; message: string };

export type SendFailureCode =
  | 'invalid_body'
  | 'not_found'
  | 'unsupported_source'
  | 'not_linked'
  | 'no_integration'
  | 'lookup_failed'
  | 'send_failed';

interface ConversationRow {
  id: string;
  source: string | null;
  external_conversation_id: string | null;
  org_id: string | null;
  channel: string | null;
  guest_name: string | null;
  property_name: string | null;
  reservation_id: string | null;
}

/**
 * Send `text` to the guest on `conversationId` through the PMS, then reflect it
 * locally so the thread shows it.
 *
 * Does NOT authorize — the caller is responsible for proving it may act on this
 * conversation (the route via RLS, the cron via the armed auto-send row it read
 * on the service client).
 */
export async function sendGuestMessage(params: {
  conversationId: string;
  text: string;
  actor: SendActor;
}): Promise<SendGuestMessageResult> {
  const { conversationId, actor } = params;
  const text = params.text.trim();
  if (!text) {
    return { ok: false, code: 'invalid_body', message: 'Message body is required' };
  }

  const service = getSupabaseServer();

  const { data: conv, error: convErr } = await service
    .from('conversations')
    .select(
      'id, source, external_conversation_id, org_id, channel, guest_name, property_name, reservation_id',
    )
    .eq('id', conversationId)
    .maybeSingle();
  if (convErr) {
    return { ok: false, code: 'lookup_failed', message: convErr.message };
  }
  if (!conv) {
    return { ok: false, code: 'not_found', message: 'Not found' };
  }
  const c = conv as ConversationRow;

  // Hostaway-only for now; Hospitable send is a fast-follow. Auto-send inherits
  // this limit — a Hospitable thread simply never fires (recorded as a failed
  // row rather than silently dropped, so the gap is visible in the log).
  if (c.source !== 'hostaway') {
    return {
      ok: false,
      code: 'unsupported_source',
      message: 'Sending is only available for Hostaway conversations right now.',
    };
  }
  if (!c.external_conversation_id || !c.org_id) {
    return { ok: false, code: 'not_linked', message: 'Conversation is not linked to Hostaway.' };
  }

  const creds = await getHostawayCredsForOrg(c.org_id);
  if (!creds) {
    return {
      ok: false,
      code: 'no_integration',
      message: 'No Hostaway integration is configured for this conversation.',
    };
  }

  // Reply through the guest's own gateway: OTA reservations (Airbnb/VRBO/Booking)
  // send as 'channel'; direct/email guests as 'email'.
  const communicationType = canonicalChannelKey(c.channel) === 'direct' ? 'email' : 'channel';

  let created: Record<string, unknown>;
  try {
    created = await sendHostawayMessage(creds, c.external_conversation_id, text, communicationType);
  } catch (err) {
    console.error('[messages send] Hostaway send failed', { conversationId, err });
    return {
      ok: false,
      code: 'send_failed',
      message: err instanceof Error ? err.message : 'Failed to send the message.',
    };
  }

  // Reflect the sent message locally from the send RESPONSE so the id matches
  // what the next thread re-pull returns (dedupe on org_id,hostaway_message_id).
  const createdId = created.id != null ? String(created.id) : null;
  const sentAt =
    hostawayDateToUtcIso(typeof created.date === 'string' ? created.date : null) ??
    new Date().toISOString();

  if (createdId) {
    const { error: insErr } = await service.from('guest_messages').upsert(
      {
        org_id: c.org_id,
        reservation_id: c.reservation_id,
        conversation_id: c.id,
        hostaway_conversation_id: c.external_conversation_id,
        hostaway_message_id: createdId,
        property_name: c.property_name,
        guest_name: c.guest_name,
        direction: 'outbound',
        // The typed text, not `created.body` — Hostaway echoes an email-gateway
        // send back as HTML ("<p>...</p>"), which would render as literal tags
        // until the re-ingest below replaced it. What the operator wrote is
        // already the plain form of exactly this message.
        body: text,
        sent_at: sentAt,
        // Who spoke. Without this an auto-send is indistinguishable from a human
        // one in the thread and in the data.
        sent_via: actor.type,
      },
      { onConflict: 'org_id,hostaway_message_id' },
    );
    if (insErr) console.error('[messages send] local echo insert failed', insErr);

    // Inbox rollup: this sent message is now the latest in the thread.
    await service
      .from('conversations')
      .update({
        last_message_at: sentAt,
        last_direction: 'outbound',
        last_message_preview: text.slice(0, 300),
        updated_at: new Date().toISOString(),
      })
      .eq('id', c.id);
  }

  // Re-pull the whole thread off the response path for full correctness
  // (message_count, any channel-side normalization). Idempotent; dedupes on id.
  after(async () => {
    try {
      await ingestConversation({ creds, orgId: c.org_id! }, c.external_conversation_id!);
    } catch (err) {
      console.error('[messages send] post-send re-ingest failed', { conversationId, err });
    }
  });

  return { ok: true, messageId: createdId, sentAt };
}
