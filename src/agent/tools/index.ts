import type { ToolDefinition } from './types';
import { findProperties } from './findProperties';
import { getPropertyKnowledge } from './getPropertyKnowledge';
import { findTasks } from './findTasks';
import { findReservations } from './findReservations';
import { findUsers } from './findUsers';
import { findTemplates } from './findTemplates';
import { findDepartments } from './findDepartments';
import { findBins } from './findBins';
import { previewTask } from './previewTask';
import { createTask } from './createTask';
import { previewBin } from './previewBin';
import { createBin } from './createBin';
import { previewTasksBatch } from './previewTasksBatch';
import { createTasksBatch } from './createTasksBatch';
import { previewTaskUpdate } from './previewTaskUpdate';
import { updateTask } from './updateTask';
import { previewTaskDelete } from './previewTaskDelete';
import { deleteTask } from './deleteTask';
import { previewComment } from './previewComment';
import { addComment } from './addComment';

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
  findReservations as unknown as ToolDefinition<unknown, unknown>,
  findUsers as unknown as ToolDefinition<unknown, unknown>,
  findTemplates as unknown as ToolDefinition<unknown, unknown>,
  findDepartments as unknown as ToolDefinition<unknown, unknown>,
  findBins as unknown as ToolDefinition<unknown, unknown>,
  previewTask as unknown as ToolDefinition<unknown, unknown>,
  createTask as unknown as ToolDefinition<unknown, unknown>,
  previewBin as unknown as ToolDefinition<unknown, unknown>,
  createBin as unknown as ToolDefinition<unknown, unknown>,
  previewTasksBatch as unknown as ToolDefinition<unknown, unknown>,
  createTasksBatch as unknown as ToolDefinition<unknown, unknown>,
  previewTaskUpdate as unknown as ToolDefinition<unknown, unknown>,
  updateTask as unknown as ToolDefinition<unknown, unknown>,
  previewTaskDelete as unknown as ToolDefinition<unknown, unknown>,
  deleteTask as unknown as ToolDefinition<unknown, unknown>,
  previewComment as unknown as ToolDefinition<unknown, unknown>,
  addComment as unknown as ToolDefinition<unknown, unknown>,
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
