import type {
  MessageParam,
  TextBlock,
  TextBlockParam,
  ToolUseBlock,
  ToolResultBlockParam,
  Tool,
} from '@anthropic-ai/sdk/resources/messages';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { getAnthropic, MODEL } from '@/src/agent/anthropic';
import { dispatchTool, type ToolCallTrace } from '@/src/agent/dispatchTool';
import { getPropertyKnowledgeForGuest } from '@/src/agent/tools/getPropertyKnowledgeForGuest';
import { checkPropertyAvailability } from '@/src/agent/tools/checkPropertyAvailability';
import { findAvailableProperties } from '@/src/agent/tools/findAvailableProperties';
import { getConciergeProcedure } from '@/src/agent/tools/getConciergeProcedure';
import type { ToolContext, ToolDefinition } from '@/src/agent/tools/types';
import {
  getConversationContext,
  type ConversationContext,
  type StayWindow,
} from './conversationContext';
import {
  getConciergeTrainingForProperty,
  formatTrainingForPrompt,
  formatTrainingIndexForPrompt,
} from './conciergeTraining';
import { loadConciergeToolFlags } from './conciergeCapabilities';
import { resolveOpsToday } from './opsToday';
import type { GuestMessageRecord } from '@/lib/messages';

// The Concierge's curated, read-only toolset. One tool for now — it can look up
// the guest-shareable property facts the operator has unlocked. The full ops
// registry is intentionally NOT imported here (that would cycle through
// concierge → draftReply); the Concierge holds its tools directly.
const CONCIERGE_TOOLS: ReadonlyArray<ToolDefinition<unknown, unknown>> = [
  getPropertyKnowledgeForGuest as unknown as ToolDefinition<unknown, unknown>,
  checkPropertyAvailability as unknown as ToolDefinition<unknown, unknown>,
  findAvailableProperties as unknown as ToolDefinition<unknown, unknown>,
  getConciergeProcedure as unknown as ToolDefinition<unknown, unknown>,
];

// Tools that are core infrastructure and must never be removed by the per-tool
// operator master switches. get_concierge_procedure loads situational training
// the system prompt only indexes by title — disabling it would advertise
// procedures the model can't open.
const ALWAYS_ON_CONCIERGE_TOOLS: ReadonlySet<string> = new Set(['get_concierge_procedure']);
const CONCIERGE_TOOLS_BY_NAME = new Map(CONCIERGE_TOOLS.map((t) => [t.name, t]));
const MAX_DRAFT_ITERATIONS = 6;

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

Availability (critical):
- When the guest asks whether the property is free, open, or bookable for any dates (e.g. "are you available the 18th–22nd?", "can I add a night?", "is next weekend open?"), call check_property_availability BEFORE answering. Pass check_in + check_out for a specific requested stay, or from + to to scan a flexible range. It already knows the property — no property argument.
- For flexible / open-ended date questions ("sometime in July", "any weekends next month"), use the window mode and quote available_windows EXACTLY as returned — each is a real check_in→check_out opening. Never compute or adjust the dates yourself (the tool already accounts for same-day turnovers). If available_windows is empty, tell the guest nothing of a workable length is open in that range.
- open_ended openings: when an opening has open_ended=true, its check_out is just the edge of the dates you searched — NOT a real checkout and NOT a booking starting then. Say it's available "from [check_in] onward" (mention the minimum-night requirement if there is one), and do not quote that check_out date as a hard end. Only state a specific check_out when open_ended is false (a real booking bounds it).
- Quoting a window: present check_in as the arrival date and check_out as the DEPARTURE date, both exactly as given. Do NOT subtract a day, do NOT describe the end as the "last night", and do NOT shorten a window to "leave room" for another booking. A check_out that lands on another reservation's check-in date is a normal same-day turnover and is fully bookable — the openings already account for this. Example: an opening {check_in 2026-06-22, check_out 2026-06-30} is "open June 22 to June 30" (arrive the 22nd, check out the 30th) — NOT "to June 29".
- It tells you only WHETHER dates are free, never why a taken date is taken. NEVER speculate about or reveal a reason for unavailability — do not say or imply the owner is staying, that it's blocked, booked, or being cleaned. A taken date is simply "not available."
- Minimum-night rule: the result is not available whenever the stay is shorter than the property's minimum (or longer than its maximum), even if the calendar is wide open — check meets_stay_rules / min_nights. Unlike a date conflict, the night minimum is a normal public booking rule you MAY tell the guest (e.g. "those dates are open, but this place has a 31-night minimum"). Offer alternatives if their stay can't meet it.
- If the dates are available, you may say so warmly (e.g. "those dates look open"), while leaving the actual booking to the team. If they're taken, say they're not available and offer to check alternatives or pass it to the team — never invent which dates ARE free beyond what the tool returned.
- Never state availability from memory or assumption; it changes constantly. Always ground it in a fresh tool call.
- Sharing this property's link: if the guest asks for the link, the listing, or how to book THIS property, call get_property_knowledge_for_guest and share the listing_link it returns (paste the raw url). Do NOT offer other properties' links in place of it — only reach for find_available_properties when the guest actually wants alternatives. If it returns no link (none on their channel), say you'll get it from the team.
- Offering alternatives: when this property is NOT available for the dates the guest wants (or they ask what else you have), you may call find_available_properties to find OTHER properties free for those dates AND bookable on the guest's own channel. Each result includes its bedroom/bathroom counts; if the guest wants more space, simply favor options with more bedrooms than this property (its size is in the facts above) — no special parameter needed. For a flexible request ("sometime in July"), call it in window mode (from + to) — each result then carries available_windows (that property's bookable check_in→check_out openings). When the guest asks "what dates is that alternative available?", answer from its available_windows (call the tool again with the window if needed) and quote them verbatim — do NOT say you can't check the alternative, and never compute the dates yourself. Each result includes a listing url on that channel — share the url so the guest can view/book it. IMPORTANT: paste the raw url as plain text (the guest's channel turns a bare link into a clickable one); do NOT wrap it in markdown link syntax like [text](url) — guests see that literally. Describe each option briefly from its city and bedroom/bathroom counts (e.g. "a similar 2-bedroom in San Diego — ") then give the url; use the display_title as the name if it is set. Only ever share a url the tool returned (it is already on the guest's own channel) — never another channel's link, never invent a property, url, or its availability. If the tool returns nothing, say nothing else is open for those dates and offer to have the team follow up. Still never reveal why the guest's original choice is unavailable.

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
  // Concierge training, split by tier:
  //  - 'always' rules are pinned into the (cached) system prefix — they govern
  //    every reply (voice, privacy, emergencies, …).
  //  - 'situational' rules are listed by title only in an index; the model loads
  //    the full body on demand via get_concierge_procedure when the message
  //    matches. This keeps the standing payload small and undiluted.
  let alwaysTrainingBlock = '';
  let situationalIndexBlock = '';
  try {
    const rules = await getConciergeTrainingForProperty(ctx.conversation.property_id);
    alwaysTrainingBlock = formatTrainingForPrompt(rules.filter((r) => r.tier !== 'situational'));
    situationalIndexBlock = formatTrainingIndexForPrompt(
      rules.filter((r) => r.tier === 'situational'),
    );
  } catch {
    // Training is enhancement, not a hard dependency — never block a draft on it.
    alwaysTrainingBlock = '';
    situationalIndexBlock = '';
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

  // Inquiry-property size — a cheap baseline so the Concierge can reason about
  // "do you have something bigger?". (The property's booking LINK is no longer
  // injected here; it's fetched on demand via get_property_knowledge_for_guest.)
  let propBedrooms: number | null = null;
  let propBathrooms: number | null = null;
  if (ctx.conversation.property_id) {
    const { data: propRow } = await getSupabaseServer()
      .from('properties')
      .select('bedrooms, bathrooms')
      .eq('id', ctx.conversation.property_id)
      .maybeSingle();
    propBedrooms = (propRow?.bedrooms as number | null) ?? null;
    propBathrooms = (propRow?.bathrooms as number | null) ?? null;
  }

  // Resolve "today" in the property's (or org default) timezone, not UTC — so a
  // late-evening US time doesn't push the guest's stay relationship a day forward.
  const today = opts.today ?? (await resolveOpsToday(ctx.conversation.property_id));
  const { stay } = ctx;
  const inLabel = stay.booked ? 'Check-in' : 'Requested check-in';
  const outLabel = stay.booked ? 'Check-out' : 'Requested check-out';
  const facts: string[] = [`Today's date: ${today}`, `Guest name: ${guestName}`];
  if (propertyName) facts.push(`Property: ${propertyName}`);
  if (propBedrooms != null) {
    facts.push(
      `This property's size: ${propBedrooms} bedroom${propBedrooms === 1 ? '' : 's'}${
        propBathrooms != null ? `, ${propBathrooms} bathroom${propBathrooms === 1 ? '' : 's'}` : ''
      }.`,
    );
  }
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
  // Stable, per-property system prefix — cached so the loop's repeated passes
  // (and repeated drafts for the same property within the cache TTL) reuse it.
  // Order: base rules → always-on training → the situational index + how to load
  // it. Everything here is constant across this draft's tool loop.
  const cachedSystemText = [
    SYSTEM_PROMPT,
    alwaysTrainingBlock
      ? `Concierge training — rules that ALWAYS apply; follow them on every reply:\n${alwaysTrainingBlock}`
      : '',
    situationalIndexBlock
      ? `Situational procedures available on demand — listed by title only, NOT shown in full. When the guest's latest message matches one of these topics, call get_concierge_procedure with the matching id(s) BEFORE replying, then follow the loaded steps (load several if more than one applies). The always-applies training above — including emergencies — is always in effect and never needs loading.\n${situationalIndexBlock}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  // The reply-warrant gate depends on the per-call sensitivity, so it rides in a
  // trailing UNCACHED block — gated and ungated drafts then share one cache entry.
  const systemBlocks: TextBlockParam[] = [
    { type: 'text', text: cachedSystemText, cache_control: { type: 'ephemeral' } },
  ];
  if (gateActive) {
    systemBlocks.push({ type: 'text', text: buildReplyGateClause(opts.replySensitivity!) });
  }

  const client = getAnthropic();
  // Per-tool master switches (operations_settings). A disabled tool is simply
  // never offered to the model; core-infra tools (ALWAYS_ON_CONCIERGE_TOOLS) are
  // exempt so the indexed procedures stay loadable. Errors degrade to the full set.
  let toolFlags: Record<string, boolean>;
  try {
    toolFlags = await loadConciergeToolFlags();
  } catch {
    toolFlags = {};
  }
  const tools: Tool[] = CONCIERGE_TOOLS.filter(
    (t) => ALWAYS_ON_CONCIERGE_TOOLS.has(t.name) || toolFlags[t.name] !== false,
  ).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.jsonSchema,
  }));
  // Cache the tools too — mark the last so tools + system form one contiguous
  // cached prefix (canonical order: tools → system → messages).
  if (tools.length > 0) {
    tools[tools.length - 1] = {
      ...tools[tools.length - 1],
      cache_control: { type: 'ephemeral' },
    };
  }
  // Bind the one property this draft is for so the guest tool can't be steered
  // to another property — it reads the id from context, not from the model.
  const toolCtx: ToolContext = {
    draft: {
      propertyId: ctx.conversation.property_id,
      channel: ctx.conversation.channel ?? null,
      category: 'reply',
    },
  };
  const conversation: MessageParam[] = [{ role: 'user', content: userParts.join('\n') }];
  const trace: ToolCallTrace[] = [];

  for (let i = 0; i < MAX_DRAFT_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: DRAFT_MAX_TOKENS,
      temperature: 0,
      system: systemBlocks,
      tools,
      messages: conversation,
    });

    // Prompt-cache observability: a creation on the first pass, reads on later
    // passes / repeat drafts for the same property within the cache TTL.
    const u = response.usage;
    console.log(
      `[concierge draft] pass ${i} cache: created=${u.cache_creation_input_tokens ?? 0} read=${u.cache_read_input_tokens ?? 0} input=${u.input_tokens}`,
    );

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
