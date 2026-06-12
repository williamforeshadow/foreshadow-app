import type {
  MessageParam,
  TextBlock,
  ToolUseBlock,
  ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/messages';
import { getAnthropic, MODEL } from '@/src/agent/anthropic';
import { dispatchTool, type ToolCallTrace } from '@/src/agent/dispatchTool';
import { getPropertyKnowledgeForGuest } from '@/src/agent/tools/getPropertyKnowledgeForGuest';
import type { ToolContext, ToolDefinition } from '@/src/agent/tools/types';
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

// The Concierge's curated, read-only toolset. One tool for now — it can look up
// the guest-shareable property facts the operator has unlocked. The full ops
// registry is intentionally NOT imported here (that would cycle through
// concierge → draftReply); the Concierge holds its tools directly.
const CONCIERGE_TOOLS: ReadonlyArray<ToolDefinition<unknown, unknown>> = [
  getPropertyKnowledgeForGuest as unknown as ToolDefinition<unknown, unknown>,
];
const CONCIERGE_TOOLS_BY_NAME = new Map(CONCIERGE_TOOLS.map((t) => [t.name, t]));
const MAX_DRAFT_ITERATIONS = 4;

// Guest-reply draft generator — the single source of truth for AI message
// creation. Reused by the concierge agent tool (chat / Slack) and the
// inbox composer's "AI draft" endpoint. It DRAFTS only; sending is a separate,
// human-confirmed step that doesn't exist yet.
//
// Voice lives here (not in the main ops agent's system prompt) so the agent
// stays terse/internal while guest-facing prose is warm. Temperature stays 0 —
// warmth comes from instruction, not sampling randomness (higher temp has been
// a reliable source of confabulation in this codebase).

const DRAFT_MAX_TOKENS = 700; // headroom for a tool-call turn + the final reply
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
- Use ONLY facts present in the conversation, the reservation/inquiry details, the property facts you retrieve via tools, and any concierge training. Do not state anything else as fact.
- NEVER invent or guess specifics: dates, times, prices, codes, wifi passwords, addresses, amenities, or availability.
- Do not confirm, promise, deny, or rule on anything — policies, permissions, rules, what is or isn't allowed — unless a provided fact states it. The guest asking about or mentioning something is never license to affirm or deny it. When you don't have the fact, warmly say you'll confirm with the team and follow up; do not reassure or refuse on your own.
- If the guest asked a direct question you CAN answer from the given facts, answer it directly.
- "Concierge training" (when present) is operating guidance from the host's team: procedures to follow when the situation matches. Follow the applicable steps and use any specifics it states (e.g. phone numbers, sequences). It is instruction, not license to invent — never fabricate a code, date, price, or fact that neither the training, the facts, nor the conversation provides.

Looking things up:
- When the guest asks something property-specific (wifi, check-in/access, parking, an amenity, a house rule) that you don't already have, call get_property_knowledge_for_guest — with no arguments; it already knows which property. Do this BEFORE replying so your answer is grounded.
- It returns only what the host's team has made available for guests. If it comes back empty, or doesn't include the specific fact the guest needs, that information hasn't been shared — do NOT guess it. Warmly tell the guest you'll confirm with the team and follow up.

Operator instruction:
- You may be given an "instruction" describing what the operator wants accomplished or conveyed (e.g. "let them know checkout is 11am"). Treat it as INTENT, not a script. Express it naturally in your own guest-facing voice, grounded only in facts you have or retrieve. Never copy the instruction verbatim, never repeat internal or operator phrasing or notes to the guest, and never relay anything in it that isn't meant for the guest's eyes. If the instruction references a specific fact (a time, price, code), only state it if it's actually provided — otherwise say you'll confirm.

Output: return ONLY the reply text the host would send. No preamble, no quotes, no explanation.`;

// Reply-warrant gate. On the AUTONOMOUS path the operator sets a sensitivity
// level (1-4) deciding how readily the concierge drafts a reply at all. We fold
// the decision into this same draft call (no extra classifier): the model
// decides FIRST and, when the message doesn't clear the bar, emits the sentinel
// and stops — no tool calls, no draft. Level 4 (and the manual/test paths) skip
// the gate entirely and always draft, matching the prior behavior.
const NO_REPLY_SENTINEL = '<<NO_REPLY>>';

// Cumulative ladder — each level includes everything a stricter (lower) level
// would answer. Kept terse and domain-light; the model judges against the bar.
const REPLY_SENSITIVITY_LADDER: Record<number, string> = {
  1: 'Urgent only — a time-sensitive problem or question: an access issue, something disrupting or blocking their stay, a safety concern, or a question that clearly needs a prompt answer.',
  2: 'Questions & issues — also any genuine question, problem, or piece of feedback that wants an answer, even if it is not urgent.',
  3: 'Anything substantive — also any message that merits a courteous response (a comment, a plan, a request, a remark). Skip ONLY pure acknowledgments or pleasantries with nothing to respond to: e.g. "thanks", "great", "sounds good", "ok", "see you then".',
  4: 'Everything — reply to every inbound message.',
};

/** Build the gate clause appended to the system prompt for levels 1-3. */
function buildReplyGateClause(level: number): string {
  const ladder = [1, 2, 3, 4]
    .map((l) => `  ${l}. ${REPLY_SENSITIVITY_LADDER[l]}`)
    .join('\n');
  return `\n\nReply-warrant gate (overrides "Always produce a real reply" above):
Before anything else, decide whether the LATEST guest message warrants a reply at the configured sensitivity level. The levels are cumulative — a level also answers everything a lower level would:
${ladder}
Configured level: ${level}.
If the latest message does NOT clear the level-${level} bar, output exactly ${NO_REPLY_SENTINEL} and nothing else — do not call any tool, do not write a message. Otherwise, draft the reply exactly as instructed above. Judge only the latest guest message (use earlier messages for context); if the host sent the most recent message, treat a follow-up as warranted only at level 4.`;
}

export interface GenerateDraftInput {
  conversationId: string;
  /**
   * Plain-English directive from the operator describing what to accomplish or
   * convey for the guest (e.g. "let them know checkout is 11am"). Intent only —
   * the Concierge decides the wording and grounds it itself. Never a place to
   * pass property facts (the Concierge retrieves its own, gated to what's
   * unlocked for guests).
   */
  instruction?: string;
  /**
   * Reply-warrant gate level (1-4). When 1-3, the concierge first decides
   * whether the latest message warrants a reply and skips drafting if not
   * (returns warranted=false). Omit (or pass 4) to always draft — the manual
   * "Regenerate" and concierge-tool paths leave this unset.
   */
  replySensitivity?: number;
}

/**
 * Generate a guest-reply draft for a conversation. Throws on a missing
 * conversation, an empty basis (no thread and no instruction), or an API error —
 * callers map that to their own error shape.
 */
export async function generateGuestReplyDraft(
  input: GenerateDraftInput,
): Promise<GuestReplyDraftResult> {
  const ctx = await getConversationContext(input.conversationId);
  if (!ctx) {
    throw new Error('Conversation not found');
  }
  return generateGuestReplyDraftFromContext(ctx, {
    instruction: input.instruction,
    replySensitivity: input.replySensitivity,
  });
}

export interface GenerateDraftFromContextOptions {
  /** Operator's plain-English intent for the message (see GenerateDraftInput.instruction). */
  instruction?: string;
  /**
   * Today's date (YYYY-MM-DD) used to ground "now" and derive the guest's
   * current relationship to the stay (checked in / upcoming / ended). Defaults
   * to the server's UTC date. The concierge test passes the property-local date
   * so simulated scenarios resolve correctly.
   */
  today?: string;
  /** Reply-warrant gate level (1-4); see GenerateDraftInput.replySensitivity. */
  replySensitivity?: number;
}

export interface GuestReplyDraftResult {
  /** The reply text, or '' when the gate decided no reply was warranted. */
  draft: string;
  /**
   * Whether a reply was warranted. Always true on the ungated paths (manual /
   * test / level 4). False only when the sensitivity gate short-circuited.
   */
  warranted: boolean;
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
): Promise<GuestReplyDraftResult> {
  // Concierge training: the property's configured operating procedures. Loaded
  // here so the inbox draft path, the concierge tool, and the test
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

  if (recent.length === 0 && !opts.instruction?.trim()) {
    throw new Error('Nothing to draft from: the conversation has no messages and no instruction was given.');
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
  if (trainingBlock) {
    userParts.push(
      '',
      'Concierge training — operating procedures to follow when the situation matches:',
      trainingBlock,
    );
  }
  userParts.push('', 'Conversation so far (oldest to newest):', transcript);
  if (opts.instruction?.trim()) {
    userParts.push(
      '',
      `Operator instruction (intent — express it in your own guest-facing voice; do not repeat it verbatim or relay anything not meant for the guest): ${opts.instruction.trim()}`,
    );
  }
  userParts.push(
    '',
    'Write the message to send to the guest now. If the host sent the most recent message, write a natural follow-up. Output only the message text.',
  );

  // The Concierge loop. The model may call its read-only tool(s) to gather
  // facts before replying; when it stops calling tools, its text is the draft.
  // With no tool call this is identical to the old single-shot path.
  // Gate is active only for levels 1-3; level 4 (or an unset level on the
  // manual/test paths) always drafts, so the system prompt is left untouched.
  const gateActive =
    typeof opts.replySensitivity === 'number' &&
    opts.replySensitivity >= 1 &&
    opts.replySensitivity <= 3;
  const system = gateActive ? SYSTEM_PROMPT + buildReplyGateClause(opts.replySensitivity!) : SYSTEM_PROMPT;

  const client = getAnthropic();
  const tools = CONCIERGE_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.jsonSchema,
  }));
  // Bind the one property this draft is for so the guest tool can't be steered
  // to another property — it reads the id from context, not from the model.
  const toolCtx: ToolContext = { draft: { propertyId: ctx.conversation.property_id } };
  const conversation: MessageParam[] = [{ role: 'user', content: userParts.join('\n') }];
  const trace: ToolCallTrace[] = [];

  for (let i = 0; i < MAX_DRAFT_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: DRAFT_MAX_TOKENS,
      temperature: 0,
      system,
      tools,
      messages: conversation,
    });

    conversation.push({ role: 'assistant', content: response.content });

    if (response.stop_reason !== 'tool_use') {
      const draft = response.content
        .filter((b): b is TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();
      // Gate short-circuit: the model judged no reply warranted at this level.
      if (gateActive && draft.includes(NO_REPLY_SENTINEL)) {
        return { draft: '', warranted: false };
      }
      if (!draft) {
        throw new Error('The model returned an empty draft.');
      }
      return { draft, warranted: true };
    }

    const toolUses = response.content.filter(
      (b): b is ToolUseBlock => b.type === 'tool_use',
    );
    const toolResults: ToolResultBlockParam[] = await Promise.all(
      toolUses.map((use) => {
        const tool = CONCIERGE_TOOLS_BY_NAME.get(use.name);
        if (!tool) {
          return Promise.resolve<ToolResultBlockParam>({
            type: 'tool_result',
            tool_use_id: use.id,
            is_error: true,
            content: JSON.stringify({
              ok: false,
              error: { code: 'unknown_tool', message: `Tool "${use.name}" is not available here.` },
            }),
          });
        }
        return dispatchTool(tool, use, trace, toolCtx);
      }),
    );
    conversation.push({ role: 'user', content: toolResults });
  }

  throw new Error('The concierge could not finish drafting a reply.');
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
