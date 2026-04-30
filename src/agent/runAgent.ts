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
const MAX_TOKENS = 1024;
// Hard ceiling on iterations. A well-behaved tool catalog should never need
// more than 3-4 round-trips for a single user question; this is a safety net.
const MAX_ITERATIONS = 10;

const SYSTEM_PROMPT = `You are an AI assistant for Foreshadow, a vacation rental property management platform.

You answer questions about the user's properties, reservations, and tasks by calling the read-only tools provided. You never write SQL. When a question requires data, call the appropriate tool, then answer using the structured data the tool returns.

Tool results come back in a uniform envelope:
- On success: { ok: true, data: ..., meta: { returned, limit, truncated } }
- On failure: { ok: false, error: { code, message, hint? } }

If a tool returns ok:false, surface the error message to the user and use the hint, if present, to suggest a clarification. Do NOT invent or guess data that wasn't returned.

If the user asks something the available tools cannot answer, say so plainly. Keep answers concise and grounded in tool output.`;

export interface RunAgentInput {
  /** Prior conversation, oldest first. Plain-text message turns only. */
  history: MessageParam[];
  /** The new user message to respond to. */
  prompt: string;
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
}: RunAgentInput): Promise<RunAgentOutput> {
  const anthropic = getAnthropic();
  const conversation: MessageParam[] = [
    ...history,
    { role: 'user', content: prompt },
  ];

  const toolCalls: ToolCallTrace[] = [];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
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
