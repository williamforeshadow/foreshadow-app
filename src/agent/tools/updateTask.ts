import { z } from 'zod';
import {
  updateTask as updateTaskService,
  type UpdateTaskFieldChange,
} from '@/src/server/tasks/updateTask';
import { consumeUpdateTaskToken } from '@/src/server/tasks/updateTaskConfirmation';
import { taskUrl } from '@/src/lib/links';
import type { ToolContext, ToolDefinition, ToolMeta, ToolResult } from './types';

// update_task — second half of the two-step write protocol for
// modifying an existing task. Accepts ONLY a confirmation_token from
// preview_task_update. The canonical input is locked in at preview
// time so the model can't swap fields between preview and commit.

const inputSchema = z.object({
  confirmation_token: z
    .string()
    .uuid()
    .describe(
      'Single-use token from a recent preview_task_update call. Required. Tokens expire 5 minutes after issuance.',
    ),
});

type Input = z.infer<typeof inputSchema>;

export interface UpdatedTaskRow {
  task_id: string;
  property_id: string | null;
  property_name: string | null;
  template_id: string | null;
  template_name: string | null;
  title: string;
  priority: string;
  department_id: string | null;
  department_name: string | null;
  status: string;
  scheduled_date: string | null;
  scheduled_time: string | null;
  bin_id: string | null;
  bin_name: string | null;
  bin_is_system: boolean;
  is_binned: boolean;
  assigned_users: Array<{ user_id: string; name: string; role: string }>;
  updated_at: string;
  completed_at: string | null;
  task_url: string;
}

export interface UpdateTaskData {
  task: UpdatedTaskRow;
  /** Field-by-field diff of what actually changed. */
  changes: UpdateTaskFieldChange[];
}

async function handler(
  input: Input,
  ctx: ToolContext,
): Promise<ToolResult<UpdateTaskData>> {
  const consumed = consumeUpdateTaskToken(input.confirmation_token);
  if (!consumed.ok) {
    return {
      ok: false,
      error: {
        code: 'confirmation_required',
        message:
          consumed.reason === 'expired'
            ? 'The confirmation token has expired. Tokens are valid for 5 minutes.'
            : 'No matching confirmation token. Tokens are issued only by preview_task_update and are single-use.',
        hint:
          'Call preview_task_update with the desired changes, present the diff to the user, get explicit confirmation, then call update_task with the new confirmation_token.',
      },
    };
  }

  const result = await updateTaskService(consumed.input, {
    actor: ctx.actor
      ? { user_id: ctx.actor.appUserId, name: ctx.actor.name }
      : null,
  });
  if (!result.ok) {
    if (result.error.code === 'invalid_input' || result.error.code === 'locked_field') {
      return {
        ok: false,
        error: {
          code: 'invalid_input',
          message: result.error.message,
          hint: result.error.field
            ? `The "${result.error.field}" field is invalid. Re-confirm via preview_task_update.`
            : 'Re-confirm the update via preview_task_update.',
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
            'A referenced row may have been deleted between preview and commit. Re-run preview_task_update.',
        },
      };
    }
    return {
      ok: false,
      error: { code: 'db_error', message: result.error.message },
    };
  }

  const t = result.task;
  const row: UpdatedTaskRow = {
    task_id: t.task_id,
    property_id: t.property_id,
    property_name: t.property_name,
    template_id: t.template_id,
    template_name: t.template_name,
    title: t.title,
    priority: t.priority,
    department_id: t.department_id,
    department_name: t.department_name,
    status: t.status,
    scheduled_date: t.scheduled_date,
    scheduled_time: t.scheduled_time,
    bin_id: t.bin_id,
    bin_name: t.bin_name,
    bin_is_system: t.bin_is_system,
    is_binned: t.is_binned,
    assigned_users: t.assigned_users,
    updated_at: t.updated_at,
    completed_at: t.completed_at,
    task_url: taskUrl(t.task_id),
  };

  const meta: ToolMeta = { returned: 1, limit: 1, truncated: false };
  return { ok: true, data: { task: row, changes: result.changes }, meta };
}

export const updateTask: ToolDefinition<Input, UpdateTaskData> = {
  name: 'update_task',
  description:
    "COMMIT updates to a task that were previewed and confirmed. Takes ONLY a confirmation_token from a recent preview_task_update call — fields are not accepted here; they were locked when the token was minted. Required workflow: 1) call preview_task_update with the desired changes → get a diff + token, 2) present the diff to the user in plain English, 3) only after the user confirms, call this tool. Returns the post-update task plus the actual change list on success, or confirmation_required if the token is missing/expired/already-used. After a successful update, narrate the outcome to the user using the changes array (e.g. 'I marked it complete and reassigned to Rae'); use the returned task_url when linking to the task.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      confirmation_token: {
        type: 'string',
        description:
          'Single-use token returned by preview_task_update. Tokens expire 5 minutes after issuance. Required.',
      },
    },
    required: ['confirmation_token'],
    additionalProperties: false,
  },
  handler,
};
