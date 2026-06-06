import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { mapHostawayMessagePayload } from '@/lib/messages';

// Hostaway guest-message webhook receiver.
//
// Hostaway POSTs here when a new conversation message arrives (guest inbound or
// host outbound). We validate a shared secret, normalize the payload, resolve
// the local reservation, and idempotently insert the message — then ack 200
// quickly so Hostaway stops retrying. Mirrors the validate -> parse -> dedup ->
// ack shape of app/api/slack/events/route.ts.

export const maxDuration = 60;

function isAuthorized(request: Request): boolean {
  const secret = process.env.HOSTAWAY_WEBHOOK_SECRET;
  // If no secret is configured, fail closed — we never want an open ingest URL.
  if (!secret) return false;

  const url = new URL(request.url);
  const fromQuery = url.searchParams.get('secret');
  if (fromQuery && fromQuery === secret) return true;

  // Also accept it via a bearer/basic Authorization header.
  const auth = request.headers.get('authorization') ?? '';
  if (auth === `Bearer ${secret}`) return true;
  if (auth.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
      // "user:pass" — accept the secret in either field.
      const [user, pass] = decoded.split(':');
      if (pass === secret || user === secret) return true;
    } catch {
      /* fall through */
    }
  }
  return false;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return new Response('unauthorized', { status: 401 });
  }

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
        .eq('hostaway_reservation_id', msg.hostawayReservationId)
        .maybeSingle();
      if (resRow) {
        reservationId = resRow.id;
        guestName = resRow.guest_name ?? null;
        propertyName = resRow.property_name ?? null;
      }
    }

    const row = {
      reservation_id: reservationId,
      hostaway_conversation_id: msg.hostawayConversationId,
      hostaway_message_id: msg.hostawayMessageId,
      property_name: propertyName,
      guest_name: guestName,
      direction: msg.direction,
      body: msg.body,
      sent_at: msg.sentAt,
    };

    // Idempotent insert — unique(hostaway_message_id) + ignoreDuplicates makes
    // Hostaway's retries / out-of-order redelivery safe.
    const { error } = await supabase
      .from('guest_messages')
      .upsert(row, { onConflict: 'hostaway_message_id', ignoreDuplicates: true });

    if (error) {
      console.error('[Hostaway Messages] insert error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

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
