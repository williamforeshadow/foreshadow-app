import { z } from 'zod';
import { createTask as createTaskService } from '@/src/server/tasks/createTask';
import { consumeCreateTaskToken } from '@/src/server/tasks/createTaskConfirmation';
import { taskUrl } from '@/src/lib/links';
import type { ToolContext, ToolDefinition, ToolMeta, ToolResult } from './types';

// create_task — second half of the two-step write protocol for tasks.
//
// This tool intentionally accepts ONLY a confirmation_token issued by
// preview_task. The full canonical input was stored server-side at preview
// time; here we just consume the token and write. This means:
//   - The model has no way to write a task without first running preview.
//   - The model has no way to swap fields between preview and commit —
//     whatever the user confirmed is exactly what gets written.
//   - The model can't bypass user confirmation by calling create_task
//     directly with fabricated inputs.
//
// Tokens are single-use and expire 5 minutes after issuance. If the user
// changes their mind mid-flow, call preview_task again — each call mints
// a fresh token.

const inputSchema = z.object({
  confirmation_token: z
    .string()
    .uuid()
    .describe(
      'Single-use token from a recent preview_task call. Required. Tokens are bound to the exact preview that issued them and expire after 5 minutes. To get one: call preview_task, present the plan to the user, get explicit confirmation, then call this tool with the token.',
    ),
});

type Input = z.infer<typeof inputSchema>;

export interface CreatedTaskRow {
  task_id: string;
  reservation_id: string | null;
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
  has_template: boolean;
  assigned_users: Array<{ user_id: string; name: string; role: string }>;
  comment_count: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  /**
   * Deep link to the new task. Mirrors find_tasks.task_url so the model can
   * confirm a successful creation with a clickable link. Absolute when
   * APP_BASE_URL is configured (required for Slack); relative otherwise.
   */
  task_url: string;
}

async function handler(
  input: Input,
  ctx: ToolContext,
): Promise<ToolResult<CreatedTaskRow>> {
  const consumed = consumeCreateTaskToken(input.confirmation_token);
  if (!consumed.ok) {
    const reason = consumed.reason;
    return {
      ok: false,
      error: {
        code: 'confirmation_required',
        message:
          reason === 'expired'
            ? 'The confirmation token has expired. Tokens are valid for 5 minutes.'
            : 'No matching confirmation token. Tokens are issued only by preview_task and are single-use.',
        hint:
          'Call preview_task with the task fields, present the plan to the user, get explicit confirmation, then call create_task with the new confirmation_token.',
      },
    };
  }

  const result = await createTaskService(consumed.input, {
    actor: ctx.actor
      ? { user_id: ctx.actor.appUserId, name: ctx.actor.name }
      : null,
  });
  if (!result.ok) {
    if (result.error.code === 'invalid_input') {
      return {
        ok: false,
        error: {
          code: 'invalid_input',
          message: result.error.message,
          hint: result.error.field
            ? `The "${result.error.field}" field is invalid. Re-confirm with the user via preview_task.`
            : 'Re-confirm the task fields with the user via preview_task.',
        },
      };
    }
    if (result.error.code === 'not_found') {
      // Should be rare — the FK was validated at preview time. Most likely
      // the row was deleted in the 5-minute window between preview and
      // commit. Tell the user, don't retry blindly.
      return {
        ok: false,
        error: {
          code: 'not_found',
          message: result.error.message,
          hint:
            'A referenced row may have been deleted between preview and commit. Re-run preview_task to resolve current ids.',
        },
      };
    }
    return {
      ok: false,
      error: { code: 'db_error', message: result.error.message },
    };
  }

  // Project the canonical CreatedTask onto the slim agent-facing shape.
  // We drop description (the agent already knows what it sent at preview)
  // and form_metadata (irrelevant on creation), and we strip user
  // email/avatar from assigned_users since they don't affect agent
  // reasoning.
  const t = result.task;
  const row: CreatedTaskRow = {
    task_id: t.task_id,
    reservation_id: t.reservation_id,
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
    has_template: t.has_template,
    assigned_users: t.assigned_users.map((a) => ({
      user_id: a.user_id,
      name: a.name,
      role: a.role,
    })),
    comment_count: t.comment_count,
    created_at: t.created_at,
    updated_at: t.updated_at,
    completed_at: t.completed_at,
    task_url: taskUrl(t.task_id),
  };

  const meta: ToolMeta = { returned: 1, limit: 1, truncated: false };
  return { ok: true, data: row, meta };
}

export const createTask: ToolDefinition<Input, CreatedTaskRow> = {
  name: 'create_task',
  description:
    "COMMIT a task that was previewed and confirmed by the user. Takes ONLY a confirmation_token from a recent preview_task call — task fields are not accepted here; they were locked in when the token was minted. Required workflow: 1) call preview_task with the task fields → get a plan + token, 2) present the plan to the user in plain English and ask for explicit confirmation, 3) only after the user confirms, call this tool with the token. The tool returns the created task on success or a confirmation_required error if the token is missing/expired/already-used. After a successful create, confirm the result back to the user using the returned title and ids.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      confirmation_token: {
        type: 'string',
        description:
          'Single-use token returned by preview_task. Tokens expire 5 minutes after issuance. Required.',
      },
    },
    required: ['confirmation_token'],
    additionalProperties: false,
  },
  handler,
};
