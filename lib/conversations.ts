// Canonical, PMS-agnostic conversation model. No PMS specifics live here — each
// PMS normalizes into these types via src/server/messages/pms/*.

import type { MessageDirection } from '@/lib/messages';

// Stored on the conversation (captured from the PMS at ingest).
export type BookingState = 'inquiry' | 'booked' | 'cancelled';

// Derived for the UI (booking_state + dates vs today).
export type ReservationStatus =
  | 'inquiry'
  | 'upcoming'
  | 'current'
  | 'past'
  | 'cancelled';

// The two inbox tabs (app-managed).
export type ConversationTab = 'active' | 'complete';

// Canonical booking channel.
export type CanonicalChannel =
  | 'airbnb'
  | 'vrbo'
  | 'bookingcom'
  | 'expedia'
  | 'direct'
  | 'manual'
  | 'other';

// A conversation header row as returned by the list API and consumed by the UI.
export interface ConversationRow {
  id: string;
  source: string;
  external_conversation_id: string;
  guest_name: string | null;
  /** Owning organization — scopes per-org settings and agent tool context. */
  org_id?: string | null;
  property_id: string | null;
  property_name: string | null;
  channel: string | null;
  reservation_id: string | null;
  booking_state: BookingState;
  reservation_status: ReservationStatus; // derived server-side
  check_in: string | null;
  check_out: string | null;
  last_message_at: string | null;
  last_direction: MessageDirection | null;
  last_message_preview: string;
  message_count: number;
  app_status: ConversationTab;
  unread: boolean;
  archived: boolean;
  // Persisted Concierge draft (generated eagerly on inbound / by the ops agent;
  // the inbox reads it rather than regenerating). null until first generated.
  proposed_reply: string | null;
  /** guest_messages.id the draft was written against — used to detect staleness. */
  proposed_reply_answers_message_id: string | null;
  proposed_reply_source: 'auto' | 'assistant' | null;
  proposed_reply_generated_at: string | null;
}

export interface ConversationCounts {
  active: number;
  complete: number;
  unread: number; // unread within Active (the highlight badge)
}

/**
 * Derive the 5-value reservation status from the stored booking_state + dates.
 * `today` is YYYY-MM-DD (caller supplies in the relevant timezone).
 */
export function deriveReservationStatus(
  bookingState: BookingState,
  checkIn: string | null,
  checkOut: string | null,
  today: string,
): ReservationStatus {
  if (bookingState === 'inquiry') return 'inquiry';
  if (bookingState === 'cancelled') return 'cancelled';
  // booked:
  const ci = checkIn ? checkIn.slice(0, 10) : null;
  const co = checkOut ? checkOut.slice(0, 10) : null;
  if (co && co < today) return 'past';
  if (ci && ci > today) return 'upcoming';
  if (ci && co && ci <= today && today <= co) return 'current';
  return 'upcoming'; // booked but indeterminate dates
}
