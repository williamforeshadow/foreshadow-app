// Guest messaging v1 — shared types + the isolated Hostaway field-map.
//
// `GuestMessageRecord` mirrors the public.guest_messages table and is the shape
// the read API + UI consume.
//
// `mapHostawayMessagePayload` is the single place that knows Hostaway's message
// field names. The message-object field names below were verified against a live
// Hostaway conversationMessage. The only remaining unknown is the webhook
// *envelope* (how the object is wrapped on delivery) — `unwrap` is lenient and
// the route logs the first real payload so it can be confirmed in one place.

export type MessageDirection = 'inbound' | 'outbound';

export interface GuestMessageRecord {
  id: string;
  reservation_id: string | null;
  hostaway_conversation_id: string | null;
  hostaway_message_id: string;
  property_name: string | null;
  guest_name: string | null;
  direction: MessageDirection;
  body: string;
  sent_at: string | null;
  created_at: string;
}

// Normalized, PMS-agnostic message extracted from a raw Hostaway payload.
// guest_name / property_name are intentionally NOT here — they aren't on the
// message object (they're on the parent conversation), so the webhook route
// derives them from the matched reservation instead.
export interface RawGuestMessage {
  hostawayMessageId: string;
  hostawayConversationId: string;
  hostawayReservationId: number | null;
  body: string;
  sentAt: string | null;
  direction: MessageDirection;
}

// === HOSTAWAY MESSAGE FIELD-MAP — verified against a live conversationMessage ==
const FIELD = {
  messageId: 'id',
  conversationId: 'conversationId',
  reservationId: 'reservationId',
  body: 'body',
  // "2026-04-07 18:53:43" — no tz; falls back to insertedOn.
  sentAt: 'date',
  // 1 => from the guest (inbound); 0 => host/automation reply (outbound).
  isIncoming: 'isIncoming',
} as const;
// =============================================================================

function firstString(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (v != null && v !== '') return String(v);
  }
  return null;
}

function toNumberOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

/**
 * Pull the message object out of a Hostaway webhook envelope. Unified webhooks
 * typically wrap the entity under `data` (sometimes `result`); fall back to the
 * payload itself if it's already the bare object.
 */
function unwrap(payload: Record<string, unknown>): Record<string, unknown> {
  const data = payload.data ?? payload.result ?? payload;
  return (data && typeof data === 'object' ? data : payload) as Record<string, unknown>;
}

/**
 * Normalize a raw Hostaway webhook payload into a `RawGuestMessage`. Returns
 * null when the payload isn't a conversation message — a message always has both
 * an `id` and a `conversationId`, so requiring both filters out any non-message
 * events (reservation/task payloads have no conversationId) that reach the URL.
 */
export function mapHostawayMessagePayload(
  payload: Record<string, unknown>,
): RawGuestMessage | null {
  const m = unwrap(payload);

  const messageId = firstString(m[FIELD.messageId]);
  const conversationId = firstString(m[FIELD.conversationId]);
  if (!messageId || !conversationId) return null;

  return {
    hostawayMessageId: messageId,
    hostawayConversationId: conversationId,
    hostawayReservationId: toNumberOrNull(m[FIELD.reservationId]),
    body: firstString(m[FIELD.body]) ?? '',
    sentAt: firstString(m[FIELD.sentAt], m.insertedOn),
    direction: m[FIELD.isIncoming] ? 'inbound' : 'outbound',
  };
}
