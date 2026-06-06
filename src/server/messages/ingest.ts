import { getSupabaseServer } from '@/lib/supabaseServer';
import {
  fetchConversation,
  fetchConversationMessages,
  fetchConversationsList,
} from '@/lib/hostaway';
import { mapHostawayMessagePayload } from '@/lib/messages';

// Shared guest-message ingestion. Anchors on the CONVERSATION (which carries the
// guest's name + listing) rather than a reservation, so inquiry threads with no
// booked reservation still ingest with a proper name. A matched reservation is
// optional enrichment (the link + a fallback name/property).

// Fields we read off a Hostaway conversation object.
type ConvHint = {
  recipientName?: unknown;
  listingMapId?: unknown;
  reservationId?: unknown;
};

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function str(v: unknown): string | null {
  return v == null || v === '' ? null : String(v);
}

/**
 * Fetch one conversation's entire message history (guest + host) and upsert it.
 * guest_name comes from the conversation's recipientName; property_name from the
 * listing (by listingMapId) or a matched reservation; reservation_id is linked
 * when the conversation's reservation is one we've synced. Pass `hint` (from a
 * conversation list) to skip the per-conversation metadata fetch.
 * Idempotent via unique hostaway_message_id. Returns messages upserted.
 */
export async function ingestConversation(
  conversationId: string | number,
  hint?: ConvHint,
): Promise<number> {
  // Conversation metadata (name / listing / reservation). Use the hint when we
  // have it (backfill from a list); otherwise fetch the conversation (webhook).
  let recipientName = str(hint?.recipientName);
  let listingMapId = num(hint?.listingMapId);
  let reservationHostawayId = num(hint?.reservationId);
  if (recipientName == null || listingMapId == null) {
    const conv = await fetchConversation(conversationId);
    recipientName = recipientName ?? str(conv?.recipientName);
    listingMapId = listingMapId ?? num(conv?.listingMapId);
    reservationHostawayId = reservationHostawayId ?? num(conv?.reservationId);
  }

  const raw = await fetchConversationMessages(conversationId);
  const mapped = raw.map(mapHostawayMessagePayload).filter((m) => m !== null);
  if (mapped.length === 0) return 0;

  const supabase = getSupabaseServer();

  // Optional reservation link + fallback name/property.
  let reservationId: string | null = null;
  let resGuest: string | null = null;
  let resProperty: string | null = null;
  const resHostId =
    reservationHostawayId ??
    mapped.find((m) => m!.hostawayReservationId != null)?.hostawayReservationId ??
    null;
  if (resHostId != null) {
    const { data } = await supabase
      .from('reservations')
      .select('id, guest_name, property_name')
      .eq('hostaway_reservation_id', resHostId)
      .maybeSingle();
    if (data) {
      reservationId = data.id;
      resGuest = data.guest_name ?? null;
      resProperty = data.property_name ?? null;
    }
  }

  // Property from the listing (works even with no reservation, e.g. inquiries).
  let listingProperty: string | null = null;
  if (listingMapId != null) {
    const { data } = await supabase
      .from('properties')
      .select('name, hostaway_name')
      .eq('hostaway_listing_id', listingMapId)
      .maybeSingle();
    if (data) listingProperty = data.hostaway_name ?? data.name ?? null;
  }

  const guestName = recipientName ?? resGuest ?? null;
  const propertyName = resProperty ?? listingProperty ?? null;

  const rows = mapped.map((m) => ({
    reservation_id: reservationId,
    hostaway_conversation_id: m!.hostawayConversationId,
    hostaway_message_id: m!.hostawayMessageId,
    property_name: propertyName,
    guest_name: guestName,
    direction: m!.direction,
    body: m!.body,
    sent_at: m!.sentAt,
  }));

  const { error } = await supabase
    .from('guest_messages')
    .upsert(rows, { onConflict: 'hostaway_message_id' });
  if (error) throw new Error(error.message);

  return rows.length;
}

/**
 * Discover + re-sync recent conversations (all types, including inquiries with
 * no booked reservation) plus every conversation we already know about. New
 * inquiry threads are pulled in; known threads get host replies that arrived
 * with no following inbound. Used by the backfill route + cron.
 */
export async function backfillRecentConversations(
  max = 80,
): Promise<{ conversations: number; messages: number }> {
  const supabase = getSupabaseServer();

  // Recent conversations from Hostaway (carry recipientName / listingMapId).
  const summaries = await fetchConversationsList(100);
  const targets = new Map<string, ConvHint>();
  for (const c of summaries) {
    const id = str(c.id);
    if (id) {
      targets.set(id, {
        recipientName: c.recipientName,
        listingMapId: c.listingMapId,
        reservationId: c.reservationId,
      });
    }
  }

  // Plus conversations we already store that may not be in the recent list.
  const { data } = await supabase
    .from('guest_messages')
    .select('hostaway_conversation_id')
    .not('hostaway_conversation_id', 'is', null);
  const known = (data ?? []) as { hostaway_conversation_id: string }[];
  for (const r of known) {
    if (!targets.has(r.hostaway_conversation_id)) {
      targets.set(r.hostaway_conversation_id, {});
    }
  }

  let messages = 0;
  let count = 0;
  for (const [id, hint] of targets) {
    if (count >= max) break;
    count += 1;
    try {
      messages += await ingestConversation(id, hint);
    } catch (err) {
      console.error('[messages backfill] conversation failed', { id, err });
    }
    await new Promise((r) => setTimeout(r, 700)); // rate-limit friendly
  }

  return { conversations: count, messages };
}
