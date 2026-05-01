import type { ToolDefinition } from './types';
import { findProperties } from './findProperties';
import { getPropertyKnowledge } from './getPropertyKnowledge';
import { findTasks } from './findTasks';

// Tool registry. To add a new tool: define it in its own file, then add it
// here. The agent loop pulls from this list — there's no other registration
// step.
//
// We type the array loosely (`unknown` generics) because handlers operate on
// validated, schema-bound inputs at the call site; the registry only needs to
// dispatch by name.
export const TOOLS: ReadonlyArray<ToolDefinition<unknown, unknown>> = [
  findProperties as unknown as ToolDefinition<unknown, unknown>,
  getPropertyKnowledge as unknown as ToolDefinition<unknown, unknown>,
  findTasks as unknown as ToolDefinition<unknown, unknown>,
];

export const TOOLS_BY_NAME: Readonly<Record<string, ToolDefinition<unknown, unknown>>> =
  Object.freeze(Object.fromEntries(TOOLS.map((t) => [t.name, t])));

/**
 * Convert the registry into the shape Anthropic expects under
 * `messages.create({ tools })`.
 */
export function toAnthropicTools() {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.jsonSchema,
  }));
}
