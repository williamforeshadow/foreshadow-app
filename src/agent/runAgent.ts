import Anthropic from '@anthropic-ai/sdk';
import type {
  MessageParam,
  ToolUseBlock,
  ToolResultBlockParam,
  TextBlock,
} from '@anthropic-ai/sdk/resources/messages';
import { TOOLS_BY_NAME, toAnthropicTools } from './tools';
import type { ToolResult } from './tools/types';

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

const MODEL = 'claude-opus-4-20250514';
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

function buildSystemPrompt(clientTz: string | undefined): string {
  const { date, tz } = todayInTz(clientTz);
  return `You are an AI assistant for Foreshadow, a vacation rental property management platform.

Current context:
- Today is ${date} (${tz}). The user is typing from this timezone.
- Stored dates and times in Foreshadow are wall-clock and timezone-agnostic. When the user uses relative language ("today", "this week", "yesterday", "overdue"), interpret it against the date above and pass concrete YYYY-MM-DD dates to tools.
- For any tool that supports a reference_date input, pass ${date} so date-relative filters (e.g. overdue) align with the user's local sense of "today".

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
- Only pass id values (property_id, template_id, department_id, reservation_id, bin_id, etc.) that you obtained from a tool result earlier in this same turn.
- Never fabricate ids, never guess them, and never reuse ids from prior conversation turns — those ids are not visible to you and cannot be trusted.
- If you don't have an id, call the appropriate resolver tool first (e.g. find_properties to look up a property by name).
- If a tool returns error.code = "not_found" for an id you passed, do NOT retry with a different guess. Call the resolver tool instead and use the id it returns.

If a tool returns ok:false, surface the error message to the user and use the hint, if present, to suggest a clarification. Do NOT invent or guess data that wasn't returned.

If the user asks something the available tools cannot answer, say so plainly. Keep answers concise and grounded in tool output.`;
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
}: RunAgentInput): Promise<RunAgentOutput> {
  const anthropic = getAnthropic();
  const conversation: MessageParam[] = [
    ...history,
    { role: 'user', content: prompt },
  ];

  // Built once per request so the date stays fresh and the user's tz is
  // baked in. Cheap to recompute.
  const systemPrompt = buildSystemPrompt(clientTz);
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
