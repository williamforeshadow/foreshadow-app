import Anthropic from '@anthropic-ai/sdk';
import type {
  MessageParam,
  ToolUseBlock,
  ToolResultBlockParam,
  TextBlock,
} from '@anthropic-ai/sdk/resources/messages';
import { TOOLS_BY_NAME, toAnthropicTools } from './tools';
import type { ToolResult } from './tools/types';

// Names of tools that mutate state. Used by the hallucination backstops
// (write-claim mask in src/agent/backstops.ts) to validate that any
// "I created..."-style claim is paired with a successful write call.
//
// Add new write tools here as they land. preview_task is included because
// it's the front half of the write protocol; the action-claim regex is
// keyed on what the model SAYS, not which tool fired, so any successful
// preview/commit pair is grounding for a confirmation message.
export const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([
  'preview_task',
  'create_task',
]);

// runAgent — single entry point that drives Anthropic's tool-use loop.
//
// Replaces the old "ask Claude for SQL, then run it" approach with a clean
// agent loop: the model can call any tool registered in src/agent/tools, we
// dispatch + return structured results, then ask the model again until it
// stops calling tools.

let client: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });
  }
  return client;
}

// Sonnet 4.6 is the current production sweet spot for tool-grounded ops chat:
// faster than Opus 4.x, cheaper, and (per Anthropic's release notes for the
// 4.6 family) tighter on instruction-following and structured tool use —
// which directly addresses the UUID/token fabrication we've seen Opus 4 do
// when it tries to shortcut find_* resolvers. The 2024-05-14 Opus alias was
// also flagged for retirement on 2026-06-15 so we'd be migrating regardless.
const MODEL = 'claude-sonnet-4-6';
// Bumped from 1024 so multi-tool turns (e.g. listing 25 tasks after a
// find_tasks call) never get truncated mid-enumeration. Truncation pushes the
// model toward summarizing/inferring instead of citing what it received.
const MAX_TOKENS = 2048;
// Deterministic decoding for ops data. Anthropic defaults to 1.0 which is
// far too creative for tool-grounded answers and a major contributor to
// confabulation. We want the model to reproduce tool output verbatim, not
// remix it.
const TEMPERATURE = 0;
// Hard ceiling on iterations. A well-behaved tool catalog should never need
// more than 3-4 round-trips for a single user question; this is a safety net.
const MAX_ITERATIONS = 10;

// Resolve "today" in the user's timezone if we have one, otherwise UTC.
// Uses 'en-CA' because that locale always formats as YYYY-MM-DD which is the
// shape every tool input (and Postgres date column) expects. An invalid IANA
// string makes Intl throw — we swallow and fall back to UTC.
function todayInTz(tz: string | undefined): { date: string; tz: string } {
  if (tz) {
    try {
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(
        new Date(),
      );
      return { date, tz };
    } catch {
      // fall through
    }
  }
  return { date: new Date().toISOString().slice(0, 10), tz: 'UTC' };
}

function buildSystemPrompt(
  clientTz: string | undefined,
  surface: AgentSurface,
  actor: AgentActor | undefined,
): string {
  const { date, tz } = todayInTz(clientTz);
  // Surface-specific opener gives the model a clue about formatting
  // expectations. Slack mrkdwn doesn't render markdown headings or
  // **bold** the same way the in-app chat (full markdown) does. The
  // route layer still post-processes for safety, but priming the model
  // here cuts down on rendering surprises.
  const surfaceLine =
    surface === 'slack'
      ? '- You are answering inside Slack. Keep replies short, plain text. Use bold sparingly with single-asterisk syntax (*bold*). Do not use markdown headings (#, ##) — Slack does not render them.'
      : '- You are answering inside the Foreshadow web app chat panel. Replies render as full markdown.';

  // Identity grounding. When the caller knows who's asking — Slack route
  // resolves Slack user → Foreshadow user via email; in-app chat will
  // pass the logged-in user once we have real auth — feed that into the
  // prompt so "me" / "my" / "I" / "mine" resolve to the right user_id
  // without the model having to call find_users by name (which would be
  // both slower and ambiguous when names collide). Falls back to a
  // permissive line when actor is unknown so the prompt stays valid.
  const actorBlock = actor
    ? `- The user you are talking to is ${actor.name} (user_id: ${actor.appUserId}). When they say "me", "my", "I", or otherwise refer to themselves, use this user_id directly — do NOT call find_users to look themselves up. Their role is "${actor.role}".`
    : `- The current user's identity is not resolved. If they refer to themselves ("me", "my"), ask which user they mean before calling tools that filter by user.`;

  return `You are an AI assistant for Foreshadow, a vacation rental property management platform.

Current context:
- Today is ${date} (${tz}). The user is typing from this timezone.
- Stored dates and times in Foreshadow are wall-clock and timezone-agnostic. When the user uses relative language ("today", "this week", "yesterday", "overdue"), interpret it against the date above and pass concrete YYYY-MM-DD dates to tools.
- For any tool that supports a reference_date input, pass ${date} so date-relative filters (e.g. overdue) align with the user's local sense of "today".
${actorBlock}
${surfaceLine}

Linking tasks (critical):
- Whenever you mention a specific task in your reply, render it as a markdown link using the task_url field returned by find_tasks or create_task: \`[task title or short label](task_url)\`.
- This applies to single tasks, lists of tasks, and confirmations after a successful create_task — every task you name gets a link.
- Use the task title as the visible label when the task has one; otherwise use the template_name. Keep the label short.
- The link target MUST be the verbatim task_url from the tool result for that exact task — never construct one yourself, never reuse a URL across tasks. If a row has no task_url, omit the link rather than inventing one.
- Both Slack and the in-app chat render markdown links correctly, so the same syntax works on every surface. Do not use any other link syntax.

List formatting (critical):
- When enumerating multiple items (tasks, properties, reservations, users, etc.), use a markdown bullet list with the asterisk character ("* "). Never use the dash character ("- ") for bullets, and never use numbered lists ("1. ", "2. ", ...) unless the user explicitly asks for ranked or ordered output. Slack mrkdwn renders "* " as a real bullet glyph but renders "- " literally as a dash; using "* " is the only marker that looks right on every surface.
${
  surface === 'slack'
    ? `- Slack-specific (STRICT): when a task line is just enumeration (e.g. "here are the tasks assigned to Rae"), the ENTIRE line is the bullet + a single markdown link whose label is just the task title. That means: "* [Task title](task_url)" and NOTHING ELSE on that line. No em-dash. No pipe. No property name. No address. No date. No time. No status. No priority. No assignee. No emoji. No parenthetical. The Block Kit card we attach below the message already shows property + status + due, so any inline metadata duplicates it and adds visual noise.
- IMPORTANT: earlier assistant turns visible to you in the conversation history may include that inline metadata or use "- " as the bullet marker (they were generated before these rules existed). Do NOT mimic them. The rules above win, every time, regardless of what prior turns look like. Each task bullet line ends at the closing ")" of the markdown link.
- For single-task answers, a brief one-sentence wrapper (e.g. "Found it — [Task title](url).") is fine; the rule applies specifically to enumerated bullet lines.`
    : `- In-app chat: brief inline metadata is acceptable since the in-app chat doesn't render task cards. Keep it short — at most one or two short fields per line (e.g. property + status), and never repeat what the title already conveys.`
}

You answer questions about the user's properties, reservations, and tasks by calling the read-only tools provided. You never write SQL. When a question requires data, call the appropriate tool, then answer using the structured data the tool returns.

Grounding rules (critical):
- You may not state any specific factual data (property names, addresses, wifi passwords, access codes, contact names, phone numbers, task titles, schedules, dates, statuses, assignees, etc.) unless that exact data appears in a tool result returned during THIS turn.
- If the user asks for any kind of data, you MUST call a tool before responding. A response that contains specific facts but has no tool calls in this turn is a violation of your contract.
- Conversation history exists only for conversational continuity (knowing what was discussed). It is NEVER a source of truth for facts. If the user references something from a prior turn ("that property", "the second one", "the cleanings you mentioned"), re-fetch the underlying data with the appropriate tool before answering — do not quote or list facts from prior assistant messages.
- If you cannot determine which tool to call from the user's message, ask a clarifying question. A clarifying question with no tool calls is acceptable; a factual answer with no tool calls is not.
- If a tool call returns zero rows or a not_found error, say so plainly. Never substitute remembered or invented data for missing tool output.

Tool results come back in a uniform envelope:
- On success: { ok: true, data: ..., meta: { returned, limit, truncated } }
- On failure: { ok: false, error: { code, message, hint? } }

Identifier rules (critical):
- Only pass id values (property_id, template_id, department_id, reservation_id, bin_id, user_id, etc.) that you obtained from a tool result earlier in this same turn.
- Never fabricate ids, never guess them, and never reuse ids from prior conversation turns — those ids are not visible to you and cannot be trusted.
- All ids in this system are random UUIDs (e.g. "a856ddd4-a9ac-4a9f-8a63-a8be59e90d74"). They are NOT derivable from names, slugs, or any text the user typed. If you catch yourself constructing a UUID-looking string from scratch, that is fabrication — stop and call the appropriate resolver instead.
- If you don't have an id, call the appropriate resolver tool first: find_properties for a property, find_templates for a template, find_departments for a department, find_bins for a bin, find_users for a person, find_reservations for a stay/guest. Resolvers exist for every id-bearing field — there is no excuse for guessing.
- If a tool returns error.code = "not_found" for an id you passed, do NOT retry with a different guess. Call the resolver tool instead and use the id it returns.

Option-listing rule (critical):
- If you ask the user to choose between options ("which template?", "which Billy?"), every option you list MUST come from a tool result returned during this same turn. Never list options from memory, training data, prior conversation, or guesses. If you don't have a tool result with the candidates, call the appropriate find_* resolver first, then list its results.
- If a resolver returns zero matches, say so directly ("I don't see a template by that name") and ask the user to rephrase or provide more detail. Do NOT improvise plausible-sounding alternatives.

Write protocol (critical):
- Any tool that creates, updates, schedules, or deletes data is a write. Today the only write surface is task creation (preview_task → create_task), but the protocol applies to every future write too.
- For task creation specifically: ALWAYS call preview_task first. preview_task validates fields and returns a plan + a single-use confirmation_token. Present the plan to the user in plain English, ask for explicit confirmation ("shall I create this task?"), and ONLY after the user agrees, call create_task with the returned confirmation_token. If the user wants to change something, call preview_task again with the updated fields — every preview returns a fresh token.
- create_task accepts ONLY a confirmation_token. It will refuse to act without one. Don't try to call create_task with task fields directly; that interface does not exist.
- The confirmation_token is a UUID returned by preview_task — copy it verbatim from the most recent preview_task result this turn. Do NOT invent tokens that look like "preview_<timestamp>" or any other custom format; only the exact UUID from preview_task is accepted.
- Action-claim rule: if your reply includes a claim that something was created, updated, scheduled, deleted, or assigned, the corresponding write tool MUST appear in this turn's tool calls AND have returned ok:true. If the write tool returned ok:false, surface the error message to the user verbatim and offer to retry — do not pretend it succeeded. If no write tool was called this turn, do not claim the action happened; describe what you would do instead.

If a tool returns ok:false, surface the error message to the user and use the hint, if present, to suggest a clarification. Do NOT invent or guess data that wasn't returned.

If the user asks something the available tools cannot answer, say so plainly. Keep answers concise and grounded in tool output.`;
}

/**
 * Where this agent run originates. Drives surface-specific tweaks in the
 * system prompt (e.g. Slack mrkdwn vs. full markdown) without changing the
 * core tool-calling loop.
 */
export type AgentSurface = 'web' | 'slack';

/**
 * The Foreshadow user the agent is talking to right now.
 *
 * Resolved before the run by the caller — Slack route does Slack user →
 * email → users row; in-app chat will pass the logged-in user once we
 * have real auth (currently just the AuthProvider's `appUser`). When set,
 * the system prompt grounds "me" / "my" / "I" to this user_id so the
 * model doesn't have to round-trip through find_users on every self-
 * referencing message (which is both slower and ambiguous when names
 * collide — two "Billy"s in the same table is a real possibility).
 */
export interface AgentActor {
  /** Foreshadow users.id UUID. */
  appUserId: string;
  /** Display name. Used in the prompt for natural-sounding grounding. */
  name: string;
  /** Permission tier; informs the model about what writes are appropriate. */
  role: 'superadmin' | 'manager' | 'staff';
}

export interface RunAgentInput {
  /** Prior conversation, oldest first. Plain-text message turns only. */
  history: MessageParam[];
  /** The new user message to respond to. */
  prompt: string;
  /**
   * Browser-supplied IANA timezone (e.g. "America/Los_Angeles"). When present,
   * the system prompt resolves "today" in this tz so the agent's relative
   * date language matches the user's local sense of time. Falls back to UTC
   * when missing or invalid.
   */
  clientTz?: string;
  /**
   * Surface this run is happening on. Affects formatting hints in the
   * system prompt only — tool dispatch is identical across surfaces.
   * Default: 'web'.
   */
  surface?: AgentSurface;
  /**
   * Identity of the user the agent is talking to. Optional today because
   * the in-app chat surface doesn't have real auth yet (any logged-in
   * user is just whoever's selected in the AuthProvider dropdown). When
   * omitted, the prompt falls back to a permissive line that asks the
   * user to disambiguate before any user-scoped tool call.
   */
  actor?: AgentActor;
}

export interface ToolCallTrace {
  name: string;
  input: unknown;
  output: ToolResult<unknown>;
}

export interface RunAgentOutput {
  text: string;
  toolCalls: ToolCallTrace[];
}

export async function runAgent({
  history,
  prompt,
  clientTz,
  surface = 'web',
  actor,
}: RunAgentInput): Promise<RunAgentOutput> {
  const anthropic = getAnthropic();
  const conversation: MessageParam[] = [
    ...history,
    { role: 'user', content: prompt },
  ];

  // Built once per request so the date stays fresh and the user's tz is
  // baked in. Cheap to recompute.
  const systemPrompt = buildSystemPrompt(clientTz, surface, actor);
  const toolCalls: ToolCallTrace[] = [];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      system: systemPrompt,
      tools: toAnthropicTools(),
      messages: conversation,
    });

    // Echo the assistant turn back into the conversation. Anthropic requires
    // the full content array (including any tool_use blocks) so the next
    // request can pair tool_use ids with our tool_result blocks.
    conversation.push({ role: 'assistant', content: response.content });

    if (response.stop_reason !== 'tool_use') {
      const text = response.content
        .filter((b): b is TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      return { text, toolCalls };
    }

    const toolUses = response.content.filter(
      (b): b is ToolUseBlock => b.type === 'tool_use',
    );

    const toolResults: ToolResultBlockParam[] = await Promise.all(
      toolUses.map((use) => dispatchToolUse(use, toolCalls)),
    );

    conversation.push({ role: 'user', content: toolResults });
  }

  return {
    text: 'I had to stop after too many tool calls without finishing. Try a simpler or more specific question.',
    toolCalls,
  };
}

async function dispatchToolUse(
  use: ToolUseBlock,
  trace: ToolCallTrace[],
): Promise<ToolResultBlockParam> {
  const tool = TOOLS_BY_NAME[use.name];
  if (!tool) {
    const result: ToolResult<unknown> = {
      ok: false,
      error: { code: 'unknown_tool', message: `Tool "${use.name}" is not registered.` },
    };
    trace.push({ name: use.name, input: use.input, output: result });
    return {
      type: 'tool_result',
      tool_use_id: use.id,
      is_error: true,
      content: JSON.stringify(result),
    };
  }

  const parsed = tool.inputSchema.safeParse(use.input);
  if (!parsed.success) {
    const result: ToolResult<unknown> = {
      ok: false,
      error: {
        code: 'invalid_input',
        message: 'Tool input failed validation.',
        hint: parsed.error.issues
          .map((iss) => `${iss.path.join('.') || '(root)'}: ${iss.message}`)
          .join('; '),
      },
    };
    trace.push({ name: use.name, input: use.input, output: result });
    return {
      type: 'tool_result',
      tool_use_id: use.id,
      is_error: true,
      content: JSON.stringify(result),
    };
  }

  try {
    const result = await tool.handler(parsed.data);
    trace.push({ name: use.name, input: parsed.data, output: result });
    return {
      type: 'tool_result',
      tool_use_id: use.id,
      is_error: result.ok === false,
      content: JSON.stringify(result),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Tool handler threw';
    const result: ToolResult<unknown> = {
      ok: false,
      error: { code: 'db_error', message },
    };
    trace.push({ name: use.name, input: parsed.data, output: result });
    return {
      type: 'tool_result',
      tool_use_id: use.id,
      is_error: true,
      content: JSON.stringify(result),
    };
  }
}
