import type {
  ToolUseBlock,
  ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/messages';
import { TOOLS_BY_NAME } from './tools';
import type { ToolContext, ToolResult } from './tools/types';
import { dispatchTool, type ToolCallTrace } from './dispatchTool';

// Registry-based dispatcher used by the ops agent (runAgent): resolve a tool by
// name from the full registry, then hand off to the registry-free dispatchTool.
export type { ToolCallTrace };

export async function dispatchToolUse(
  use: ToolUseBlock,
  trace: ToolCallTrace[],
  ctx: ToolContext,
): Promise<ToolResultBlockParam> {
  const tool = TOOLS_BY_NAME[use.name];
  if (!tool) {
    const result: ToolResult<unknown> = {
      ok: false,
      error: { code: 'unknown_tool', message: `Tool "${use.name}" is not registered.` },
    };
    trace.push({ name: use.name, input: use.input, output: result });
    return { type: 'tool_result', tool_use_id: use.id, is_error: true, content: JSON.stringify(result) };
  }
  return dispatchTool(tool, use, trace, ctx);
}
