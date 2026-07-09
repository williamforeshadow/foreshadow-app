import { NextResponse, after } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { mapHostawayMessagePayload } from '@/lib/messages';
import { ingestConversation } from '@/src/server/messages/ingest';
import { maybeGenerateProposedReplyForExternal } from '@/src/server/messages/proposedReply';
import { maybeGenerateProposedTaskForExternal } from '@/src/server/messages/proposedTask';
import { maybeGenerateProposedKnowledgeForExternal } from '@/src/server/messages/proposedKnowledge';
import { resolveHostawayIntegrationByWebhookSecret, hostawayCredsFor } from '@/lib/pmsIntegrations';

// Hostaway guest-message webhook receiver.
//
// Hostaway's `message.received` event only delivers INBOUND guest messages —
// host replies never webhook to us. So we store the inbound message immediately
// (so it's never lost), then off the response path pull the conversation's FULL
// thread from the API to bring in host/outbound messages too. Validate -> store
// inbound -> ack 200 fast -> sync full thread, mirroring app/api/slack/events.

export const maxDuration = 60;

// Extract the webhook secret the caller presented (query param or bearer/basic
// header). The secret selects the tenant: it's looked up against
// pms_integrations.webhook_secret (with an env fallback for the org-1 row).
function extractProvidedSecret(request: Request): string | null {
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get('secret');
  if (fromQuery) return fromQuery;

  const auth = request.headers.get('authorization') ?? '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  if (auth.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
      // "user:pass" — accept the secret in either field.
      const [user, pass] = decoded.split(':');
      return pass || user || null;
    } catch {
      return null;
    }
  }
  return null;
}

export async function POST(request: Request) {
  // Resolve the tenant from the presented webhook secret. Fails closed.
  const providedSecret = extractProvidedSecret(request);
  const integration = providedSecret
    ? await resolveHostawayIntegrationByWebhookSecret(providedSecret)
    : null;
  if (!integration) {
    return new Response('unauthorized', { status: 401 });
  }
  const orgId = integration.org_id;

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return new Response('invalid json', { status: 400 });
  }

  const msg = mapHostawayMessagePayload(payload);
  if (!msg) {
    // No usable message id — ack so Hostaway doesn't retry a payload we can't
    // map, but surface it in logs for the de-risk pass.
    console.warn('[Hostaway Messages] unmappable payload (no message id)');
    return NextResponse.json({ ok: true, ignored: 'no_message_id' });
  }

  try {
    const supabase = getSupabaseServer();

    // Resolve the reservation leniently: match Hostaway's reservation id to a
    // synced reservation. If it isn't here yet, insert with null and back-link
    // later — never drop the message. The reservation also supplies the
    // denormalized guest_name / property_name (the message object itself doesn't
    // carry them — they live on the parent conversation).
    let reservationId: string | null = null;
    let guestName: string | null = null;
    let propertyName: string | null = null;
    if (msg.hostawayReservationId != null) {
      const { data: resRow } = await supabase
        .from('reservations')
        .select('id, guest_name, property_name')
        .eq('org_id', orgId)
        .eq('hostaway_reservation_id', msg.hostawayReservationId)
        .maybeSingle();
      if (resRow) {
        reservationId = resRow.id;
        guestName = resRow.guest_name ?? null;
        propertyName = resRow.property_name ?? null;
      }
    }

    const row = {
      org_id: orgId,
      reservation_id: reservationId,
      hostaway_conversation_id: msg.hostawayConversationId,
      hostaway_message_id: msg.hostawayMessageId,
      property_name: propertyName,
      guest_name: guestName,
      direction: msg.direction,
      body: msg.body,
      sent_at: msg.sentAt,
    };

    // Idempotent insert — unique(org_id, hostaway_message_id) + ignoreDuplicates
    // makes Hostaway's retries / out-of-order redelivery safe (per-org scoped).
    const { error } = await supabase
      .from('guest_messages')
      .upsert(row, { onConflict: 'org_id,hostaway_message_id', ignoreDuplicates: true });

    if (error) {
      console.error('[Hostaway Messages] insert error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Off the response path: pull the whole thread so host/outbound replies
    // (which never webhook to us) get synced. Idempotent; failures are logged
    // but don't fail the ack.
    after(async () => {
      try {
        await ingestConversation({ creds: hostawayCredsFor(integration), orgId }, msg.hostawayConversationId, null, {
          realtime: true,
        });
      } catch (err) {
        console.error('[Hostaway Messages] thread sync failed', {
          conversationId: msg.hostawayConversationId,
          err,
        });
      }
      // Eager Concierge draft: once the thread is synced, if the guest is now
      // awaiting a reply, draft one and store it so it's waiting in the inbox.
      // Best-effort — never fails the webhook (the helper swallows its errors).
      await maybeGenerateProposedReplyForExternal(msg.hostawayConversationId);
      // Eager task triage: independently decide whether the guest's message
      // implies operational work and, if so, draft a task for review. Also
      // best-effort and self-contained.
      await maybeGenerateProposedTaskForExternal(msg.hostawayConversationId);
      // Eager knowledge triage: if the (now-synced) thread revealed a durable
      // fact about the property worth saving, draft a knowledge proposal. Gated
      // internally to threads that have a host message; best-effort.
      await maybeGenerateProposedKnowledgeForExternal(msg.hostawayConversationId);
    });

    return NextResponse.json({ ok: true, reservation_linked: reservationId != null });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Hostaway Messages] Error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Health check so the URL is verifiable in a browser.
export async function GET() {
  return NextResponse.json({ ok: true });
}
