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
  // "2026-04-07 18:53:43" — naive UTC, no tz; falls back to insertedOn.
  // Normalized through hostawayDateToUtcIso so it stores as the right instant.
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
 * Hostaway's message `date` / `insertedOn` is a naive **UTC** timestamp with no
 * zone, e.g. "2026-06-07 19:33:22". Mark it as UTC and normalize to an ISO
 * string before it's stored, so it lands as the correct instant in a timestamptz
 * column. Without the explicit zone the database parses the naive value in its
 * own session timezone (America/Los_Angeles here) and shifts every message ~7-8h
 * into the future — which then mis-renders times and trips the scheduled check.
 */
export function hostawayDateToUtcIso(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  // Already carries a zone (Z or ±HH:MM)? Trust it and let Date parse natively.
  const zoned = /([zZ])$|([+-]\d{2}:?\d{2})$/.test(s);
  const iso = zoned ? s : `${s.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Hostaway returns message bodies as HTML when the message went out over the
 * **email** gateway (communicationType 'email' — direct guests), and as plain
 * text over the OTA channel gateway (Airbnb/VRBO/Booking). So a host reply
 * arrives as "<p>Hi Sarah,</p>\n<p>...</p>" while the guest's own messages, and
 * everything on an OTA thread, are already plain. Nothing downstream expects
 * markup: the thread renders `body` as text (React escapes it, so the tags show
 * literally), the inbox preview is a substring of it, and the concierge is fed
 * these bodies as examples of how the host writes — HTML there teaches it to
 * emit HTML back.
 *
 * Normalize on the way in, at the single mapper, rather than at each render:
 * one place, and the AI context and previews are fixed for free.
 *
 * Structure is preserved, not merely stripped — most of these bodies are
 * multi-paragraph, so a blind tag-strip would run separate paragraphs together
 * into one run-on line. `</p>` becomes a blank line, `<br>` a single newline,
 * and only then are the remaining tags (`<span>` is the only other one Hostaway
 * emits) dropped. A body with no markup at all — the common case — skips the
 * rewriting and is only trimmed: plain-text bodies routinely carry a trailing
 * newline or two after a signature block, which renders as an empty line in the
 * bubble.
 */
export function normalizeMessageBody(raw: string): string {
  if (!raw.includes('<')) return raw.trim();

  const text = raw
    // Block boundaries -> newlines, before any tag is dropped.
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n\n')
    .replace(/<\/(div|li|tr|h[1-6])\s*>/gi, '\n')
    // Everything else (<p>, <span>, ...) carries no text of its own.
    .replace(/<[^>]*>/g, '')
    // Hostaway's HTML bodies carry no entities today, but decoding is cheap and
    // an escaped body is worse than a stripped one. &amp; last so "&amp;lt;"
    // doesn't decode twice into a stray "<".
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&');

  return text
    .replace(/[ \t]+\n/g, '\n') // trailing spaces the tags left behind
    .replace(/\n{3,}/g, '\n\n') // a blank line is the most separation we keep
    .trim();
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
    body: normalizeMessageBody(firstString(m[FIELD.body]) ?? ''),
    sentAt: hostawayDateToUtcIso(firstString(m[FIELD.sentAt], m.insertedOn)),
    direction: m[FIELD.isIncoming] ? 'inbound' : 'outbound',
  };
}
