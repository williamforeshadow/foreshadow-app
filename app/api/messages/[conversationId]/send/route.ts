import { NextResponse, after } from 'next/server';
import { requireAuthContext } from '@/lib/requireAuthContext';
import { getHostawayCredsForOrg } from '@/lib/pmsIntegrations';
import { sendHostawayMessage } from '@/lib/hostaway';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { ingestConversation } from '@/src/server/messages/ingest';
import { hostawayDateToUtcIso } from '@/lib/messages';
import { canonicalChannelKey } from '@/lib/bookingChannel';

export const maxDuration = 60;

// POST /api/messages/[conversationId]/send — send a host reply to the guest
// through the PMS (Hostaway only for now), then reflect it locally so the thread
// shows it. Drafting is elsewhere; this is the actual, human-confirmed send.
export async function POST(
  request: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  const ctx = await requireAuthContext();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;

  const { conversationId } = await context.params;

  let payload: { body?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const text = typeof payload.body === 'string' ? payload.body.trim() : '';
  if (!text) {
    return NextResponse.json({ error: 'Message body is required' }, { status: 400 });
  }

  // Authorize via the RLS-governed user client — another org's id reads as
  // absent (404). The send + local reflection then run on the service client.
  const { data: conv, error: convErr } = await supabase
    .from('conversations')
    .select(
      'id, source, external_conversation_id, org_id, channel, guest_name, property_name, reservation_id',
    )
    .eq('id', conversationId)
    .maybeSingle();
  if (convErr) {
    return NextResponse.json({ error: convErr.message }, { status: 500 });
  }
  if (!conv) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const c = conv as {
    id: string;
    source: string | null;
    external_conversation_id: string | null;
    org_id: string | null;
    channel: string | null;
    guest_name: string | null;
    property_name: string | null;
    reservation_id: string | null;
  };

  // Hostaway-only for now; Hospitable send is a fast-follow.
  if (c.source !== 'hostaway') {
    return NextResponse.json(
      { error: 'Sending is only available for Hostaway conversations right now.' },
      { status: 400 },
    );
  }
  if (!c.external_conversation_id || !c.org_id) {
    return NextResponse.json({ error: 'Conversation is not linked to Hostaway.' }, { status: 400 });
  }

  const creds = await getHostawayCredsForOrg(c.org_id);
  if (!creds) {
    return NextResponse.json(
      { error: 'No Hostaway integration is configured for this conversation.' },
      { status: 400 },
    );
  }

  // Reply through the guest's own gateway: OTA reservations (Airbnb/VRBO/Booking)
  // send as 'channel'; direct/email guests as 'email'.
  const communicationType = canonicalChannelKey(c.channel) === 'direct' ? 'email' : 'channel';

  let created: Record<string, unknown>;
  try {
    created = await sendHostawayMessage(creds, c.external_conversation_id, text, communicationType);
  } catch (err) {
    console.error('[messages send] Hostaway send failed', { conversationId, err });
    const message = err instanceof Error ? err.message : 'Failed to send the message.';
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // Reflect the sent message locally from the send RESPONSE so the id matches
  // what the next thread re-pull returns (dedupe on org_id,hostaway_message_id).
  const service = getSupabaseServer();
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
        body: typeof created.body === 'string' && created.body ? created.body : text,
        sent_at: sentAt,
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

  return NextResponse.json({ ok: true, message_id: createdId, sent_at: sentAt });
}
