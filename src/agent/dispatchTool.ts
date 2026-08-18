import type { ToolContext, ToolResult, ToolDefinition } from './tools/types';

// Structural stand-ins for the SDK's ToolUseBlock / ToolResultBlockParam.
// This module serves two loops on different API namespaces — runAgent on
// beta.messages, the Concierge draft generators on plain messages — and the
// SDK's beta and non-beta block types are not mutually assignable. We only
// read id/name/input and only ever emit string-content results, so a minimal
// shape both namespaces accept keeps this file namespace-agnostic.
export interface ToolUseBlock {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultBlockParam {
  type: 'tool_result';
  tool_use_id: string;
  is_error: boolean;
  content: string;
}

// Registry-free tool execution: validate the model's input against a RESOLVED
// tool's zod schema, run its handler with the per-run ToolContext, and wrap the
// ToolResult in an Anthropic tool_result block. Kept separate from dispatch.ts
// (which does the registry lookup) so callers that already hold a specific tool
// — e.g. the Concierge sub-agent with its curated subset — can dispatch without
// importing the full registry (that would create an import cycle through
// concierge → draftReply).

export interface ToolCallTrace {
  name: string;
  input: unknown;
  output: ToolResult<unknown>;
}

export async function dispatchTool(
  tool: ToolDefinition<unknown, unknown>,
  use: ToolUseBlock,
  trace: ToolCallTrace[],
  ctx: ToolContext,
): Promise<ToolResultBlockParam> {
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
    return { type: 'tool_result', tool_use_id: use.id, is_error: true, content: JSON.stringify(result) };
  }

  try {
    const result = await tool.handler(parsed.data, ctx);
    trace.push({ name: use.name, input: parsed.data, output: result });
    return {
      type: 'tool_result',
      tool_use_id: use.id,
      is_error: result.ok === false,
      content: JSON.stringify(result),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Tool handler threw';
    const result: ToolResult<unknown> = { ok: false, error: { code: 'db_error', message } };
    trace.push({ name: use.name, input: parsed.data, output: result });
    return { type: 'tool_result', tool_use_id: use.id, is_error: true, content: JSON.stringify(result) };
  }
}
