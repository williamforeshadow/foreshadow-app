import { z } from 'zod';
import { deleteTask as deleteTaskService } from '@/src/server/tasks/deleteTask';
import { consumeDeleteTaskToken } from '@/src/server/tasks/deleteTaskConfirmation';
import type { ToolDefinition, ToolMeta, ToolResult } from './types';

// delete_task — second half of the two-step delete protocol. Accepts
// ONLY a confirmation_token from preview_task_delete. The task_id is
// stored against the token at preview time so the model can't redirect
// the delete to a different row between preview and commit.
//
// Returns the snapshot of the deleted task (title, property, etc.) so
// the agent can confirm "I deleted X" without a follow-up read (and
// can't, since the row is gone).

const inputSchema = z.object({
  confirmation_token: z
    .string()
    .uuid()
    .describe(
      'Single-use token from a recent preview_task_delete call. Required. Tokens expire 5 minutes after issuance.',
    ),
});

type Input = z.infer<typeof inputSchema>;

export interface DeletedTaskRow {
  task_id: string;
  title: string;
  property_name: string | null;
  template_name: string | null;
  scheduled_date: string | null;
  status: string;
}

async function handler(input: Input): Promise<ToolResult<DeletedTaskRow>> {
  const consumed = consumeDeleteTaskToken(input.confirmation_token);
  if (!consumed.ok) {
    return {
      ok: false,
      error: {
        code: 'confirmation_required',
        message:
          consumed.reason === 'expired'
            ? 'The confirmation token has expired. Tokens are valid for 5 minutes.'
            : 'No matching confirmation token. Tokens are issued only by preview_task_delete and are single-use.',
        hint:
          'Call preview_task_delete with the task_id, present the impact to the user, get explicit confirmation, then call delete_task with the new confirmation_token.',
      },
    };
  }

  const result = await deleteTaskService(consumed.input);
  if (!result.ok) {
    if (result.error.code === 'invalid_input') {
      return {
        ok: false,
        error: {
          code: 'invalid_input',
          message: result.error.message,
          hint: 'Re-run preview_task_delete to mint a fresh token.',
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
            'The task may have been deleted between preview and commit. Tell the user it is already gone.',
        },
      };
    }
    return {
      ok: false,
      error: { code: 'db_error', message: result.error.message },
    };
  }

  const meta: ToolMeta = { returned: 1, limit: 1, truncated: false };
  return { ok: true, data: result.deleted, meta };
}

export const deleteTask: ToolDefinition<Input, DeletedTaskRow> = {
  name: 'delete_task',
  description:
    "COMMIT a task deletion that was previewed and confirmed. Takes ONLY a confirmation_token from a recent preview_task_delete call — the task_id was locked when the token was minted. Required workflow: 1) call preview_task_delete with task_id → get impact summary + token, 2) present the impact to the user (title, property, comment count, assignment count) and ask for explicit confirmation, 3) only after the user confirms, call this tool. Returns the snapshot of the deleted task on success (title, property, etc., for the confirmation message), or confirmation_required if the token is missing/expired/already-used. After a successful delete, confirm using the snapshot — and DO NOT include a task_url since the row no longer exists.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      confirmation_token: {
        type: 'string',
        description:
          'Single-use token returned by preview_task_delete. Tokens expire 5 minutes after issuance. Required.',
      },
    },
    required: ['confirmation_token'],
    additionalProperties: false,
  },
  handler,
};
