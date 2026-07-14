import { getSupabaseServer } from '@/lib/supabaseServer';
import type { ConversationRow } from '@/lib/conversations';
import type { GuestMessageRecord } from '@/lib/messages';

// Shared reader for "everything about one conversation" — the conversation row,
// its full message thread (oldest first), and the linked reservation when one
// exists. Used by the /messages/[conversationId] thread route, the
// read_conversation_thread agent tool, and the guest-reply draft generator, so
// the query lives in exactly one place.

export interface ReservationContext {
  reservation_id: string;
  guest_name: string | null;
  property_name: string | null;
  guest_count: number | null;
  check_in: string | null;
  check_out: string | null;
  nights: number | null;
}

export interface StayWindow {
  check_in: string | null;
  check_out: string | null;
  nights: number | null;
  /** true when these come from a confirmed reservation; false for an inquiry's requested dates. */
  booked: boolean;
}

export interface ConversationContext {
  conversation: ConversationRow;
  messages: GuestMessageRecord[];
  reservation: ReservationContext | null;
  /**
   * Unified stay window: the reservation's dates when booked, otherwise the
   * inquiry's requested dates carried on the conversation row (Hostaway provides
   * these for inquiries too). Either field may be null for an open inquiry.
   */
  stay: StayWindow;
}

/**
 * Load a conversation, its thread, and (if linked) its reservation. Returns
 * null when the conversation id doesn't exist. Throws on a hard DB error so
 * callers can surface it.
 */
export async function getConversationContext(
  conversationId: string,
): Promise<ConversationContext | null> {
  const supabase = getSupabaseServer();

  const { data: conversation, error: convError } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', conversationId)
    .maybeSingle();
  if (convError) throw new Error(convError.message);
  if (!conversation) return null;

  const { data: messages, error: msgError } = await supabase
    .from('guest_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('sent_at', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: true });
  if (msgError) throw new Error(msgError.message);

  let reservation: ReservationContext | null = null;
  const reservationId = (conversation as ConversationRow).reservation_id;
  if (reservationId) {
    const { data: resRow, error: resError } = await supabase
      .from('reservations')
      .select('id, guest_name, property_name, guest_count, check_in, check_out')
      .eq('id', reservationId)
      .maybeSingle();
    if (resError) throw new Error(resError.message);
    if (resRow) {
      reservation = {
        reservation_id: resRow.id as string,
        guest_name: (resRow.guest_name as string | null) ?? null,
        property_name: (resRow.property_name as string | null) ?? null,
        guest_count: (resRow.guest_count as number | null) ?? null,
        check_in: toDateOnly(resRow.check_in as string | null),
        check_out: toDateOnly(resRow.check_out as string | null),
        nights: diffNights(
          resRow.check_in as string | null,
          resRow.check_out as string | null,
        ),
      };
    }
  }

  const conv = conversation as ConversationRow;
  const stay: StayWindow = reservation
    ? {
        check_in: reservation.check_in,
        check_out: reservation.check_out,
        nights: reservation.nights,
        booked: true,
      }
    : {
        check_in: toDateOnly(conv.check_in),
        check_out: toDateOnly(conv.check_out),
        nights: diffNights(conv.check_in, conv.check_out),
        booked: false,
      };

  return {
    conversation: conv,
    messages: (messages ?? []) as GuestMessageRecord[],
    reservation,
    stay,
  };
}

function toDateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.length >= 10 ? value.slice(0, 10) : value;
}

function diffNights(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const startMs = Date.parse(`${start.slice(0, 10)}T00:00:00Z`);
  const endMs = Date.parse(`${end.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return Math.max(0, Math.round((endMs - startMs) / 86_400_000));
}
