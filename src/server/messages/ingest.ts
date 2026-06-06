import { getSupabaseServer } from '@/lib/supabaseServer';
import { fetchConversationMessages } from '@/lib/hostaway';
import { mapHostawayMessagePayload } from '@/lib/messages';

// Shared guest-message ingestion. Pulls a conversation's FULL thread (both
// directions) from Hostaway and upserts every message. The webhook only ever
// delivers inbound guest messages, so this is how host/outbound replies get in.

type ReservationLookup = {
  id: string;
  guest_name: string | null;
  property_name: string | null;
};

/**
 * Fetch one conversation's entire message history from Hostaway and upsert all
 * messages (guest + host). guest_name / property_name are taken from the matched
 * reservation. Idempotent via the unique hostaway_message_id.
 * Returns the number of messages upserted.
 */
export async function ingestConversation(
  conversationId: string | number,
): Promise<number> {
  const raw = await fetchConversationMessages(conversationId);
  const mapped = raw.map(mapHostawayMessagePayload).filter((m) => m !== null);
  if (mapped.length === 0) return 0;

  const supabase = getSupabaseServer();

  // Resolve reservation -> guest/property for the distinct reservation ids in
  // this thread (usually exactly one).
  const reservationIds = [
    ...new Set(
      mapped
        .map((m) => m!.hostawayReservationId)
        .filter((id): id is number => id != null),
    ),
  ];
  const resByHostawayId = new Map<number, ReservationLookup>();
  if (reservationIds.length > 0) {
    const { data: resRows } = await supabase
      .from('reservations')
      .select('id, hostaway_reservation_id, guest_name, property_name')
      .in('hostaway_reservation_id', reservationIds);
    for (const r of resRows ?? []) {
      resByHostawayId.set(r.hostaway_reservation_id, {
        id: r.id,
        guest_name: r.guest_name ?? null,
        property_name: r.property_name ?? null,
      });
    }
  }

  const rows = mapped.map((m) => {
    const res =
      m!.hostawayReservationId != null
        ? resByHostawayId.get(m!.hostawayReservationId)
        : undefined;
    return {
      reservation_id: res?.id ?? null,
      hostaway_conversation_id: m!.hostawayConversationId,
      hostaway_message_id: m!.hostawayMessageId,
      property_name: res?.property_name ?? null,
      guest_name: res?.guest_name ?? null,
      direction: m!.direction,
      body: m!.body,
      sent_at: m!.sentAt,
    };
  });

  const { error } = await supabase
    .from('guest_messages')
    .upsert(rows, { onConflict: 'hostaway_message_id' });
  if (error) throw new Error(error.message);

  return rows.length;
}

/**
 * Re-sync every conversation we already know about (distinct conversation ids in
 * guest_messages). Catches host replies that arrive with no subsequent inbound
 * guest message — those never trigger the webhook. Used by the backfill route +
 * cron. Returns per-conversation upsert counts.
 */
export async function backfillKnownConversations(): Promise<{
  conversations: number;
  messages: number;
}> {
  const supabase = getSupabaseServer();
  const { data } = await supabase
    .from('guest_messages')
    .select('hostaway_conversation_id')
    .not('hostaway_conversation_id', 'is', null);

  const rows = (data ?? []) as { hostaway_conversation_id: string | null }[];
  const ids: string[] = [
    ...new Set(
      rows
        .map((r) => r.hostaway_conversation_id)
        .filter((v): v is string => v != null),
    ),
  ];

  let messages = 0;
  for (const id of ids) {
    try {
      messages += await ingestConversation(id);
    } catch (err) {
      console.error('[messages backfill] conversation failed', { id, err });
    }
    await new Promise((r) => setTimeout(r, 700)); // rate-limit friendly
  }

  return { conversations: ids.length, messages };
}
