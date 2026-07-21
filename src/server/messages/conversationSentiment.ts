import type { MessageParam, TextBlock } from '@anthropic-ai/sdk/resources/messages';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { getAnthropic, MODEL } from '@/src/agent/anthropic';
import { deriveReservationStatus, type BookingState } from '@/lib/conversations';
import {
  getConversationContext,
  type ConversationContext,
} from './conversationContext';
import { getLatestSentMessage } from './proposedReply';
import { loadSentimentSummaryEnabled } from './conciergeCapabilities';
import { resolveOpsToday } from './opsToday';
import type { GuestMessageRecord } from '@/lib/messages';

// Guest-sentiment summary generator — the reservation panel's third artifact,
// sibling to proposedReply / proposedTask / proposedKnowledge. It reads a
// conversation's whole thread PLUS its reservation context and produces:
//   - a coarse sentiment verdict: positive | neutral | negative
//   - a tight 1-2 sentence summary of the MOST relevant matter (not a rehash).
// Persisted on the conversation row; the panel reads it (never regenerates).
//
// Generated eagerly on the realtime ingest path, keyed by the internal
// conversation id — so it's PMS-agnostic: any PMS whose ingest resolves a
// canonical conversation id gets it for free. Temperature 0: a stable read of
// the same thread, not a creative one.

export type Sentiment = 'positive' | 'neutral' | 'negative';
const SENTIMENTS: readonly Sentiment[] = ['positive', 'neutral', 'negative'];

const SENTIMENT_MAX_TOKENS = 300; // a verdict + 1-2 sentences, with headroom
const MAX_THREAD_MESSAGES = 30;

const SYSTEM_PROMPT = `You read an ongoing conversation between a short-term-rental host's team and a guest, and you assess the GUEST's overall sentiment toward their stay/booking so far.

Output discipline (critical):
- Respond with a single JSON object and nothing else: {"sentiment": "positive" | "neutral" | "negative", "summary": "<1-2 sentences>"}.
- "sentiment" is the guest's overall disposition across the whole thread — how they seem to feel about the property, the host, and their trip. Weigh the most recent messages more heavily. Use "neutral" for routine, transactional, or logistics-only exchanges with no clear positive or negative charge.
- "summary" is at most two short sentences. Surface only the MOST relevant matter — who the guest is / why they're here, their dates if notable, and anything driving the sentiment (a request, an issue, praise). Do NOT rehash the whole conversation. If there is nothing notable, a compact factual line is perfect (e.g. "Jasmine is visiting with family Aug 3-6. No issues raised.").
- Write the summary as a neutral third-person note to the host's team, referring to the guest by name. Never address the guest. Never include advice or next steps.`;

interface SentimentResult {
  sentiment: Sentiment;
  summary: string;
}

/** A concise reservation-status line for the model, from booking_state + dates. */
function describeStatus(
  bookingState: BookingState,
  checkIn: string | null,
  checkOut: string | null,
  today: string,
): string {
  const status = deriveReservationStatus(bookingState, checkIn, checkOut, today);
  switch (status) {
    case 'inquiry':
      return 'Reservation status: inquiry — not booked yet.';
    case 'upcoming':
      return 'Reservation status: booked — upcoming stay, guest has not arrived yet.';
    case 'current':
      return 'Reservation status: booked — guest is currently checked in.';
    case 'past':
      return 'Reservation status: booked — the stay has ended.';
    case 'cancelled':
      return 'Reservation status: cancelled.';
    default:
      return 'Reservation status: booked.';
  }
}

function isFuture(m: GuestMessageRecord, nowMs: number): boolean {
  const ts = m.sent_at;
  return !!ts && new Date(ts).getTime() > nowMs;
}

function parseSentimentJson(raw: string): SentimentResult | null {
  const unfenced = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(unfenced.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const sentiment = SENTIMENTS.includes(o.sentiment as Sentiment)
    ? (o.sentiment as Sentiment)
    : null;
  const summary = typeof o.summary === 'string' ? o.summary.trim() : '';
  if (!sentiment || !summary) return null;
  return { sentiment, summary };
}

/** Assess sentiment for an already-loaded context. Returns null if unusable. */
export async function generateConversationSentimentFromContext(
  ctx: ConversationContext,
  opts: { today?: string } = {},
): Promise<SentimentResult | null> {
  const nowMs = Date.now();
  const sent = ctx.messages.filter((m) => !isFuture(m, nowMs));
  const recent = sent.slice(-MAX_THREAD_MESSAGES);
  if (recent.length === 0) return null;

  const guestName =
    ctx.reservation?.guest_name ?? ctx.conversation.guest_name ?? 'the guest';
  const propertyName =
    ctx.reservation?.property_name ?? ctx.conversation.property_name ?? null;
  const guestCount = ctx.reservation?.guest_count ?? null;
  const today = opts.today ?? (await resolveOpsToday(ctx.conversation.property_id));

  const facts: string[] = [`Guest name: ${guestName}`];
  if (propertyName) facts.push(`Property: ${propertyName}`);
  facts.push(
    describeStatus(
      ctx.conversation.booking_state,
      ctx.stay.check_in ?? ctx.conversation.check_in,
      ctx.stay.check_out ?? ctx.conversation.check_out,
      today,
    ),
  );
  if (ctx.stay.check_in)
    facts.push(`${ctx.stay.booked ? 'Check-in' : 'Requested check-in'}: ${ctx.stay.check_in}`);
  if (ctx.stay.check_out)
    facts.push(`${ctx.stay.booked ? 'Check-out' : 'Requested check-out'}: ${ctx.stay.check_out}`);
  if (ctx.stay.nights != null) facts.push(`Nights: ${ctx.stay.nights}`);
  if (guestCount != null) facts.push(`Party size: ${guestCount}`);

  const transcript = recent
    .map(
      (m) =>
        `${m.direction === 'outbound' ? 'Host' : 'Guest'}: ${(m.body ?? '').trim() || '(no text)'}`,
    )
    .join('\n');

  const userText = [
    'Reservation details:',
    facts.map((f) => `- ${f}`).join('\n'),
    '',
    'Conversation so far (oldest to newest):',
    transcript,
    '',
    'Assess the guest\'s overall sentiment and respond with the JSON object only.',
  ].join('\n');

  const client = getAnthropic();
  const messages: MessageParam[] = [{ role: 'user', content: userText }];
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: SENTIMENT_MAX_TOKENS,
    temperature: 0,
    system: SYSTEM_PROMPT,
    messages,
  });

  const raw = response.content
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  const parsed = parseSentimentJson(raw);
  if (!parsed) {
    console.warn('[sentiment] unparseable model output', { raw: raw.slice(0, 200) });
    return null;
  }
  return parsed;
}

/**
 * Generate a sentiment summary for a conversation and PERSIST it on the row.
 * Returns the result, or null when there's nothing to assess / it's unparseable.
 * Throws on generation/DB errors (the eager wrapper swallows them).
 */
export async function generateAndStoreConversationSentiment(
  conversationId: string,
): Promise<SentimentResult | null> {
  const ctx = await getConversationContext(conversationId);
  if (!ctx) throw new Error('Conversation not found');
  const result = await generateConversationSentimentFromContext(ctx);
  if (!result) return null;

  const latest = await getLatestSentMessage(conversationId);
  const { error } = await getSupabaseServer()
    .from('conversations')
    .update({
      sentiment: result.sentiment,
      sentiment_summary: result.summary,
      sentiment_answers_message_id: latest?.id ?? null,
      sentiment_generated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);
  if (error) throw new Error(error.message);
  return result;
}

/**
 * Eager hook for the realtime ingest path (any PMS). Keyed by the INTERNAL
 * conversation id — best-effort and never throws: sentiment is an enhancement
 * and must not break ingest. Skips archived/complete threads, respects the
 * per-org master switch, and skips regeneration when the summary already
 * answers the latest message.
 */
export async function maybeGenerateSentimentForConversation(
  conversationId: string,
): Promise<void> {
  try {
    const supabase = getSupabaseServer();
    const { data: conv } = await supabase
      .from('conversations')
      .select('id, org_id, app_status, archived, concierge_enabled, sentiment_answers_message_id')
      .eq('id', conversationId)
      .maybeSingle();
    if (!conv) return;
    const c = conv as {
      id: string;
      org_id: string | null;
      app_status: 'active' | 'complete';
      archived: boolean;
      concierge_enabled: boolean;
      sentiment_answers_message_id: string | null;
    };
    if (c.archived || c.app_status !== 'active') return;

    // Per-conversation kill switch: the operator is running this thread by hand.
    if (c.concierge_enabled === false) return;

    // Per-org master switch (autonomous path only).
    if (!(await loadSentimentSummaryEnabled(c.org_id))) return;

    // Already current for the latest message — nothing new to assess. Unlike
    // proposed_reply this fires regardless of who sent last: sentiment reflects
    // the whole thread, not "awaiting a reply".
    const latest = await getLatestSentMessage(conversationId);
    if (latest && c.sentiment_answers_message_id === latest.id) return;

    await generateAndStoreConversationSentiment(conversationId);
  } catch (err) {
    console.error('[sentiment] eager generation failed', { conversationId, err });
  }
}
