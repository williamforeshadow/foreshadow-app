import type { TextBlock } from '@anthropic-ai/sdk/resources/messages';
import { getAnthropic, MODEL } from '@/src/agent/anthropic';
import {
  getConversationContext,
  type ConversationContext,
  type StayWindow,
} from './conversationContext';
import {
  getConciergeTrainingForProperty,
  formatTrainingForPrompt,
} from './conciergeTraining';
import type { GuestMessageRecord } from '@/lib/messages';

// Guest-reply draft generator — the single source of truth for AI message
// creation. Reused by the draft_guest_reply agent tool (chat / Slack) and the
// inbox composer's "AI draft" endpoint. It DRAFTS only; sending is a separate,
// human-confirmed step that doesn't exist yet.
//
// Voice lives here (not in the main ops agent's system prompt) so the agent
// stays terse/internal while guest-facing prose is warm. Temperature stays 0 —
// warmth comes from instruction, not sampling randomness (higher temp has been
// a reliable source of confabulation in this codebase).

const DRAFT_MAX_TOKENS = 500;
const MAX_THREAD_MESSAGES = 30; // recent context is enough; threads are short

const SYSTEM_PROMPT = `You draft the next message a short-term-rental host's team should send to a guest in an ongoing conversation. Your entire output is that message, ready to send.

Output discipline (critical):
- Output ONLY the message text to send to the guest. Never address the operator, never ask the operator for anything, never comment on whether a reply is needed, and never explain your reasoning. This text may be sent to the guest exactly as written, so it must always be a valid, sendable guest message — never advice, notes, or questions about the conversation.
- Always produce a real reply. If the guest just said or asked something, respond to it. If the most recent message is the host's own (the guest hasn't written back yet), write a warm, natural FOLLOW-UP that moves things forward — a friendly check-in, a helpful offer, or a gentle nudge toward booking or next steps — without repeating what was already said.

Voice:
- Warm, friendly, and professional. Write like a helpful human host, not a bot.
- Concise — usually 1 to 4 sentences. Match the guest's language and tone.
- No emojis. No sign-off or name (a human adds that before sending).
- Plain prose only: no markdown, headings, bullet lists, or labels.

Grounding (critical — this text may be sent to a real customer):
- Use ONLY facts present in the conversation, the reservation/inquiry details, and the "Known facts" you are given.
- NEVER invent or guess specifics: dates, times, prices, codes, wifi passwords, addresses, amenities, or availability.
- Do not confirm, promise, deny, or rule on anything — policies, permissions, rules, what is or isn't allowed — unless a provided fact states it. The guest asking about or mentioning something is never license to affirm or deny it. When you don't have the fact, warmly say you'll confirm with the team and follow up; do not reassure or refuse on your own.
- If the guest asked a direct question you CAN answer from the given facts, answer it directly.
- "Concierge training" (when present) is operating guidance from the host's team: procedures to follow when the situation matches. Follow the applicable steps and use any specifics it states (e.g. phone numbers, sequences). It is instruction, not license to invent — never fabricate a code, date, price, or fact that neither the training, the facts, nor the conversation provides.

Output: return ONLY the reply text the host would send. No preamble, no quotes, no explanation.`;

export interface GenerateDraftInput {
  conversationId: string;
  /** Extra facts the caller gathered (e.g. property knowledge) to ground the reply. */
  contextNotes?: string;
  /** What the human wants the message to convey, if specified. */
  guidance?: string;
}

/**
 * Generate a guest-reply draft for a conversation. Throws on a missing
 * conversation, an empty basis (no thread and no guidance), or an API error —
 * callers map that to their own error shape.
 */
export async function generateGuestReplyDraft(
  input: GenerateDraftInput,
): Promise<{ draft: string }> {
  const ctx = await getConversationContext(input.conversationId);
  if (!ctx) {
    throw new Error('Conversation not found');
  }
  return generateGuestReplyDraftFromContext(ctx, {
    contextNotes: input.contextNotes,
    guidance: input.guidance,
  });
}

export interface GenerateDraftFromContextOptions {
  /** Extra facts the caller gathered (e.g. property knowledge) to ground the reply. */
  contextNotes?: string;
  /** What the human wants the message to convey, if specified. */
  guidance?: string;
  /**
   * Today's date (YYYY-MM-DD) used to ground "now" and derive the guest's
   * current relationship to the stay (checked in / upcoming / ended). Defaults
   * to the server's UTC date. The concierge test passes the property-local date
   * so simulated scenarios resolve correctly.
   */
  today?: string;
}

/**
 * Core draft generation from an already-built conversation context. This is the
 * exact path a real guest reply takes — concierge-training auto-injection,
 * voice, and grounding all live here. The concierge test harness builds a
 * synthetic context and calls this directly, so the model sees precisely what
 * it would for a real guest (no "this is a test" signal anywhere). Throws on an
 * empty basis (no thread and no guidance) or an API error.
 */
export async function generateGuestReplyDraftFromContext(
  ctx: ConversationContext,
  opts: GenerateDraftFromContextOptions = {},
): Promise<{ draft: string }> {
  // Concierge training: the property's configured operating procedures. Loaded
  // here so the inbox draft path, the draft_guest_reply tool, and the test
  // harness all honor it identically.
  let trainingBlock = '';
  try {
    const rules = await getConciergeTrainingForProperty(ctx.conversation.property_id);
    trainingBlock = formatTrainingForPrompt(rules);
  } catch {
    // Training is enhancement, not a hard dependency — never block a draft on it.
    trainingBlock = '';
  }

  const nowMs = Date.now();
  // Only actually-sent messages form the basis for a reply; future-dated
  // (scheduled) host automations aren't part of the exchange yet.
  const sent = ctx.messages.filter(
    (m) => !isFuture(m, nowMs),
  );
  const recent = sent.slice(-MAX_THREAD_MESSAGES);

  if (recent.length === 0 && !opts.guidance?.trim()) {
    throw new Error('Nothing to draft from: the conversation has no messages and no guidance was given.');
  }

  const guestName =
    ctx.reservation?.guest_name ?? ctx.conversation.guest_name ?? 'the guest';
  const propertyName =
    ctx.reservation?.property_name ?? ctx.conversation.property_name ?? null;

  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const { stay } = ctx;
  const inLabel = stay.booked ? 'Check-in' : 'Requested check-in';
  const outLabel = stay.booked ? 'Check-out' : 'Requested check-out';
  const facts: string[] = [`Today's date: ${today}`, `Guest name: ${guestName}`];
  if (propertyName) facts.push(`Property: ${propertyName}`);
  if (stay.check_in) facts.push(`${inLabel}: ${stay.check_in}`);
  if (stay.check_out) facts.push(`${outLabel}: ${stay.check_out}`);
  if (stay.nights != null) facts.push(`Nights: ${stay.nights}`);
  facts.push(describeBooking(stay, today));

  const transcript = recent.length
    ? recent
        .map((m) => `${m.direction === 'outbound' ? 'Host' : 'Guest'}: ${(m.body ?? '').trim() || '(no text)'}`)
        .join('\n')
    : '(no prior messages)';

  const userParts = [
    'Reservation details:',
    facts.map((f) => `- ${f}`).join('\n'),
  ];
  if (opts.contextNotes?.trim()) {
    userParts.push('', 'Known facts (use these to answer; do not go beyond them):', opts.contextNotes.trim());
  }
  if (trainingBlock) {
    userParts.push(
      '',
      'Concierge training — operating procedures to follow when the situation matches:',
      trainingBlock,
    );
  }
  userParts.push('', 'Conversation so far (oldest to newest):', transcript);
  if (opts.guidance?.trim()) {
    userParts.push('', `What this reply should convey: ${opts.guidance.trim()}`);
  }
  userParts.push(
    '',
    'Write the message to send to the guest now. If the host sent the most recent message, write a natural follow-up. Output only the message text.',
  );

  const client = getAnthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: DRAFT_MAX_TOKENS,
    temperature: 0,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userParts.join('\n') }],
  });

  const draft = response.content
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  if (!draft) {
    throw new Error('The model returned an empty draft.');
  }

  return { draft };
}

function isFuture(m: GuestMessageRecord, nowMs: number): boolean {
  const ts = m.sent_at;
  return !!ts && new Date(ts).getTime() > nowMs;
}

/**
 * One-line booking fact that tells the model the guest's CURRENT relationship to
 * the stay (so it answers a checked-in guest differently from a prospect). Day
 * granularity; `today` is YYYY-MM-DD in the relevant timezone.
 */
function describeBooking(stay: StayWindow, today: string): string {
  const ci = stay.check_in ? stay.check_in.slice(0, 10) : null;
  const co = stay.check_out ? stay.check_out.slice(0, 10) : null;

  if (!stay.booked) {
    return ci
      ? `Booking: inquiry — the guest requested ${ci}${co ? ` to ${co}` : ''}, not yet booked.`
      : 'Booking: inquiry — no dates provided yet; the guest has not booked.';
  }
  if (co && co < today) {
    return `Booking: confirmed reservation — the stay has ended (checked out ${co}).`;
  }
  if (ci && ci > today) {
    return `Booking: confirmed reservation — upcoming stay; the guest has not arrived yet (check-in ${ci}).`;
  }
  if (ci && ci <= today && (!co || today <= co)) {
    return `Booking: confirmed reservation — the guest is currently checked in${
      ci && co ? ` (staying ${ci} to ${co})` : ''
    }.`;
  }
  return 'Booking: confirmed reservation.';
}
