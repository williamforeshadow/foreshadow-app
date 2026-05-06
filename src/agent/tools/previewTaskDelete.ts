import { z } from 'zod';
import {
  previewDeleteTask,
  type DeleteTaskPlan,
} from '@/src/server/tasks/deleteTask';
import { mintDeleteTaskToken } from '@/src/server/tasks/deleteTaskConfirmation';
import type { ToolDefinition, ToolResult } from './types';

// preview_task_delete — first half of the two-step protocol for
// deleting a task. Today the underlying delete is HARD (the row goes
// away along with cascading comments and assignments). The preview
// surfaces the impact (title, property, comment count, assignment
// count) so the agent can warn the user before committing.
//
// The preview doubles as a sanity check: if the agent has the wrong
// task_id (typo, drift between turns), preview's not_found error
// fires before any destructive action runs.

const inputSchema = z.object({
  task_id: z
    .string()
    .uuid()
    .describe(
      'UUID of the task to delete. Resolve with find_tasks first when the user names the task.',
    ),
});

type Input = z.infer<typeof inputSchema>;

export interface PreviewTaskDeleteResultData {
  plan: DeleteTaskPlan;
  confirmation_token: string;
  expires_at: string;
}

async function handler(
  input: Input,
): Promise<ToolResult<PreviewTaskDeleteResultData>> {
  const result = await previewDeleteTask(input);

  if (!result.ok) {
    if (result.error.code === 'invalid_input') {
      return {
        ok: false,
        error: {
          code: 'invalid_input',
          message: result.error.message,
          hint: result.error.field
            ? `Check the "${result.error.field}" field and call again.`
            : undefined,
        },
      };
    }
    if (result.error.code === 'not_found') {
      return {
        ok: false,
        error: {
          code: 'not_found',
          message: result.error.message,
          hint:
            'Call find_tasks to resolve the task by name/template/property and use the returned task_id. If the user is referring to a task they just saw, the row may have already been deleted.',
        },
      };
    }
    return {
      ok: false,
      error: { code: 'db_error', message: result.error.message },
    };
  }

  const minted = mintDeleteTaskToken(result.canonicalInput);
  return {
    ok: true,
    data: {
      plan: result.plan,
      confirmation_token: minted.token,
      expires_at: minted.expires_at,
    },
    meta: { returned: 1, limit: 1, truncated: false },
  };
}

export const previewTaskDelete: ToolDefinition<Input, PreviewTaskDeleteResultData> = {
  name: 'preview_task_delete',
  description:
    "PREVIEW deleting a task. ALWAYS call this first when the user asks to delete, remove, or trash a task. Surfaces the task's title, property, scheduled date, comment count, and assignment count — all of which will be lost on commit. Returns a confirmation_token. After calling: present the impact in plain English (e.g. 'Delete \"Bathroom deep clean\" at Beach House — has 3 comments and 2 assignees. Confirm?'), require explicit user confirmation, and only then call delete_task with the token. Tokens are single-use and expire in 5 minutes. Delete is HARD today (the row is removed, cascading comments and assignments) — make sure the user understands this before confirming. preview_task_delete never writes; safe to call repeatedly.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      task_id: {
        type: 'string',
        description:
          'UUID of the task to delete. Use find_tasks to resolve from a name first.',
      },
    },
    required: ['task_id'],
    additionalProperties: false,
  },
  handler,
};
