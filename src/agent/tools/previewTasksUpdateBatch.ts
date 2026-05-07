import { z } from 'zod';
import {
  previewUpdateTasksBatch,
  type UpdateTasksBatchPlan,
} from '@/src/server/tasks/updateTasksBatch';
import { mintUpdateTasksBatchToken } from '@/src/server/tasks/updateTasksBatchConfirmation';
import { createPendingAction } from '@/src/server/agent/pendingActions';
import type { ToolContext, ToolDefinition, ToolResult } from './types';

const STATUS_ENUM = z.enum([
  'contingent',
  'not_started',
  'in_progress',
  'paused',
  'complete',
]);
const PRIORITY_ENUM = z.enum(['urgent', 'high', 'medium', 'low']);
const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const timeString = z
  .string()
  .regex(/^\d{2}:\d{2}$/, 'expected HH:MM (24-hour)');

const taskUpdateSchema = z.object({
  task_id: z.string().uuid(),
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  status: STATUS_ENUM.optional(),
  priority: PRIORITY_ENUM.optional(),
  scheduled_date: dateString.nullable().optional(),
  scheduled_time: timeString.nullable().optional(),
  department_id: z.string().uuid().nullable().optional(),
  bin_id: z.string().uuid().nullable().optional(),
  is_binned: z.boolean().optional(),
  assigned_user_ids: z.array(z.string().uuid()).optional(),
});

const inputSchema = z.object({
  tasks: z.array(taskUpdateSchema).min(1).max(20),
});

type Input = z.infer<typeof inputSchema>;

export interface PreviewTasksUpdateBatchResultData {
  plan: UpdateTasksBatchPlan;
  confirmation_token: string;
  expires_at: string;
  pending_action_id?: string | null;
}

async function handler(
  input: Input,
  ctx: ToolContext,
): Promise<ToolResult<PreviewTasksUpdateBatchResultData>> {
  const result = await previewUpdateTasksBatch(input);
  if (!result.ok) {
    const hint = result.error.field
      ? `Check task ${((result.error.task_index ?? 0) + 1).toString()}'s "${result.error.field}" field and call again.`
      : result.error.task_index !== undefined
        ? `Check task ${(result.error.task_index + 1).toString()} and call again.`
        : undefined;
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
        hint,
      },
    };
  }

  const minted = mintUpdateTasksBatchToken(result.canonicalInput);
  const pendingActionId =
    ctx.surface === 'slack' && ctx.slack && result.plan.change_count > 0
      ? await createPendingAction({
          kind: 'update_tasks_batch',
          requesterAppUserId: ctx.actor?.appUserId ?? null,
          slack: ctx.slack,
          canonicalInput: { input: result.canonicalInput },
          preview: result.plan,
        })
      : null;

  return {
    ok: true,
    data: {
      plan: result.plan,
      confirmation_token: minted.token,
      expires_at: minted.expires_at,
      pending_action_id: pendingActionId,
    },
    meta: {
      returned: result.plan.tasks.length,
      limit: 20,
      truncated: false,
      change_count: result.plan.change_count,
      no_op_count: result.plan.no_op_count,
    },
  };
}

export const previewTasksUpdateBatch: ToolDefinition<
  Input,
  PreviewTasksUpdateBatchResultData
> = {
  name: 'preview_tasks_update_batch',
  description:
    "PREVIEW updates to multiple existing tasks as one confirmable batch. Use this instead of calling preview_task_update repeatedly when the user asks to apply the same kind of change to more than one task, such as setting department/priority/status/assignees across a list. Returns one confirmation_token and, on Slack, one pending_action_id for the entire batch. Present one plan covering all changed tasks; if some tasks are already up to date, say they will be skipped. If change_count is 0, tell the user nothing would change and do not commit.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      tasks: {
        type: 'array',
        minItems: 1,
        maxItems: 20,
        items: {
          type: 'object',
          properties: {
            task_id: {
              type: 'string',
              description: 'Task UUID. Resolve with find_tasks first.',
            },
            title: { type: 'string', description: 'New title.' },
            description: {
              type: ['string', 'null'],
              description: 'New plain-text description, or null to clear.',
            },
            status: {
              type: 'string',
              enum: [
                'contingent',
                'not_started',
                'in_progress',
                'paused',
                'complete',
              ],
              description: 'New status.',
            },
            priority: {
              type: 'string',
              enum: ['urgent', 'high', 'medium', 'low'],
              description: 'New priority.',
            },
            scheduled_date: {
              type: ['string', 'null'],
              description: 'New scheduled date YYYY-MM-DD, or null to clear.',
            },
            scheduled_time: {
              type: ['string', 'null'],
              description: 'New scheduled time HH:MM, or null to clear.',
            },
            department_id: {
              type: ['string', 'null'],
              description: 'New department UUID, or null to clear.',
            },
            bin_id: {
              type: ['string', 'null'],
              description: 'New sub-bin UUID, or null to clear.',
            },
            is_binned: {
              type: 'boolean',
              description: 'Override binned state.',
            },
            assigned_user_ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'Replacement list of assignee UUIDs.',
            },
          },
          required: ['task_id'],
          additionalProperties: false,
        },
      },
    },
    required: ['tasks'],
    additionalProperties: false,
  },
  handler,
};
