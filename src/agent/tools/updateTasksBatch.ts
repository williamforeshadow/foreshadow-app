import { z } from 'zod';
import { updateTasksBatch as updateTasksBatchService } from '@/src/server/tasks/updateTasksBatch';
import { consumeUpdateTasksBatchToken } from '@/src/server/tasks/updateTasksBatchConfirmation';
import { taskUrl } from '@/src/lib/links';
import type { ToolContext, ToolDefinition, ToolMeta, ToolResult } from './types';
import type { UpdatedTaskRow } from './updateTask';

const inputSchema = z.object({
  confirmation_token: z
    .string()
    .uuid()
    .describe(
      'Single-use token from a recent preview_tasks_update_batch call.',
    ),
});

type Input = z.infer<typeof inputSchema>;

export interface UpdateTasksBatchData {
  updated: Array<{
    task: UpdatedTaskRow;
    changes: Array<{ field: string; before: string | null; after: string | null }>;
  }>;
  skipped: Array<{
    task_id: string;
    title: string;
    task_url: string;
  }>;
  failures: Array<{
    task_index: number;
    task_id: string;
    title: string | null;
    error: { code: string; message: string; field?: string };
  }>;
}

async function handler(
  input: Input,
  ctx: ToolContext,
): Promise<ToolResult<UpdateTasksBatchData>> {
  const consumed = consumeUpdateTasksBatchToken(input.confirmation_token);
  if (!consumed.ok) {
    return {
      ok: false,
      error: {
        code: 'confirmation_required',
        message:
          consumed.reason === 'expired'
            ? 'The confirmation token has expired. Tokens are valid for 5 minutes.'
            : 'No matching confirmation token. Tokens are issued only by preview_tasks_update_batch and are single-use.',
        hint:
          'Call preview_tasks_update_batch with the batch fields, present the plan to the user, get explicit confirmation, then call update_tasks_batch with the new confirmation_token.',
      },
    };
  }

  const result = await updateTasksBatchService(consumed.input, {
    actor: ctx.actor
      ? { user_id: ctx.actor.appUserId, name: ctx.actor.name }
      : null,
  });
  if (!result.ok) {
    return {
      ok: false,
      error: {
        code:
          result.error.code === 'not_found'
            ? 'not_found'
            : result.error.code === 'db_error'
              ? 'db_error'
              : 'invalid_input',
        message: result.error.message,
        hint: 'Re-confirm the batch via preview_tasks_update_batch.',
      },
    };
  }

  const updated = result.result.updated.map((entry) => ({
    task: {
      task_id: entry.task.task_id,
      property_id: entry.task.property_id,
      property_name: entry.task.property_name,
      template_id: entry.task.template_id,
      template_name: entry.task.template_name,
      title: entry.task.title,
      priority: entry.task.priority,
      department_id: entry.task.department_id,
      department_name: entry.task.department_name,
      status: entry.task.status,
      scheduled_date: entry.task.scheduled_date,
      scheduled_time: entry.task.scheduled_time,
      bin_id: entry.task.bin_id,
      bin_name: entry.task.bin_name,
      bin_is_system: entry.task.bin_is_system,
      is_binned: entry.task.is_binned,
      assigned_users: entry.task.assigned_users,
      updated_at: entry.task.updated_at,
      completed_at: entry.task.completed_at,
      task_url: taskUrl(entry.task.task_id),
    },
    changes: entry.changes,
  }));

  const skipped = result.result.skipped.map((plan) => ({
    task_id: plan.task_id,
    title: plan.current_title,
    task_url: taskUrl(plan.task_id),
  }));

  const failures = result.result.failures.map((failure) => ({
    task_index: failure.task_index,
    task_id: failure.task_id,
    title: failure.title,
    error: {
      code: failure.error.code,
      message: failure.error.message,
      field: failure.error.field,
    },
  }));

  const meta: ToolMeta = {
    returned: updated.length,
    limit: 20,
    truncated: false,
    skipped: skipped.length,
    failed: failures.length,
  };

  return {
    ok: true,
    data: { updated, skipped, failures },
    meta,
  };
}

export const updateTasksBatch: ToolDefinition<Input, UpdateTasksBatchData> = {
  name: 'update_tasks_batch',
  description:
    "COMMIT a multi-task update that was previewed and confirmed by the user. Takes ONLY a confirmation_token from preview_tasks_update_batch. Returns updated tasks, skipped no-op tasks, and per-task failures. Partial failures are possible; narrate exactly how many tasks updated, which were already up to date, and which failed.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      confirmation_token: {
        type: 'string',
        description:
          'Single-use token returned by preview_tasks_update_batch. Tokens expire after 5 minutes.',
      },
    },
    required: ['confirmation_token'],
    additionalProperties: false,
  },
  handler,
};
