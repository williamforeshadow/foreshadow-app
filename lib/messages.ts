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

// One conversation thread = one inbox row. Built by grouping guest_messages on
// their hostaway_conversation_id.
export interface GuestConversation {
  conversation_id: string;
  guest_name: string | null;
  property_name: string | null;
  reservation_id: string | null;
  last_message_at: string | null;
  last_message_preview: string;
  last_direction: MessageDirection;
  message_count: number;
  // Full thread, oldest -> newest, so the row can expand into the conversation.
  messages: GuestMessageRecord[];
}

/**
 * Group a flat list of messages into conversation threads (one per
 * hostaway_conversation_id). Messages with no conversation id fall back to a
 * per-reservation, then per-message, key so they never vanish. Returns
 * conversations sorted newest-activity-first, each with its messages oldest-first.
 */
export function groupMessagesIntoConversations(
  messages: GuestMessageRecord[],
): GuestConversation[] {
  const byKey = new Map<string, GuestMessageRecord[]>();
  for (const m of messages) {
    const key =
      m.hostaway_conversation_id ??
      (m.reservation_id ? `res:${m.reservation_id}` : `msg:${m.id}`);
    const list = byKey.get(key);
    if (list) list.push(m);
    else byKey.set(key, [m]);
  }

  const when = (m: GuestMessageRecord) => m.sent_at ?? m.created_at ?? '';
  // Scheduled/automated messages carry a future send time; they're not yet sent,
  // so they must not drive the conversation's last-message time, preview, or sort.
  const nowMs = Date.now();
  const isSent = (m: GuestMessageRecord) => {
    const t = m.sent_at ?? m.created_at;
    return !t || new Date(t).getTime() <= nowMs;
  };

  const conversations: GuestConversation[] = [];
  for (const [key, list] of byKey) {
    const ordered = [...list].sort((a, b) => when(a).localeCompare(when(b)));
    const reversed = [...ordered].reverse();
    // Last *sent* message anchors the row; fall back to the latest if all are
    // scheduled (a brand-new thread with only a queued automation).
    const last = reversed.find(isSent) ?? ordered[ordered.length - 1];
    // Prefer the most recent sent message that actually has text for the preview.
    const lastWithText = reversed.find((m) => isSent(m) && !!m.body?.trim());
    // Guest/property: take the first non-null across the thread.
    const guest = ordered.find((m) => m.guest_name)?.guest_name ?? null;
    const property = ordered.find((m) => m.property_name)?.property_name ?? null;
    const reservation = ordered.find((m) => m.reservation_id)?.reservation_id ?? null;

    conversations.push({
      conversation_id: key,
      guest_name: guest,
      property_name: property,
      reservation_id: reservation,
      last_message_at: last.sent_at ?? last.created_at,
      last_message_preview: lastWithText?.body?.trim() || '(no text)',
      last_direction: last.direction,
      message_count: ordered.length,
      messages: ordered,
    });
  }

  conversations.sort((a, b) =>
    (b.last_message_at ?? '').localeCompare(a.last_message_at ?? ''),
  );
  return conversations;
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
