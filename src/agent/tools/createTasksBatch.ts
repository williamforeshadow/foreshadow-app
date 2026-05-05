import { z } from 'zod';
import {
  createTasksBatch as createTasksBatchService,
  type BatchTaskFailure,
} from '@/src/server/tasks/createTasksBatch';
import { consumeCreateTasksBatchToken } from '@/src/server/tasks/createTasksBatchConfirmation';
import { taskUrl } from '@/src/lib/links';
import { binsIndexUrl } from '@/src/lib/links';
import type { ToolDefinition, ToolMeta, ToolResult } from './types';

// create_tasks_batch — second half of the batch task write protocol.
//
// Same shape as create_task / create_bin: accepts ONLY a confirmation
// token from preview_tasks_batch. Field inputs aren't accepted here;
// the canonical input is stored server-side at preview time. The model
// has no way to bypass preview.
//
// Partial-failure semantics:
//   - When at least one task lands (or a new sub-bin lands), this
//     tool returns ok:true and reports per-task failures inside data.
//     The agent should mention partial outcomes honestly: "I created
//     4 of 5 — task 5 failed because <reason>. Want me to retry just
//     that one?"
//   - When zero tasks AND no new bin landed, the tool returns ok:false
//     so the action-claim backstop won't allow a "I created N tasks"
//     message to slip through.

const inputSchema = z.object({
  confirmation_token: z
    .string()
    .uuid()
    .describe(
      'Single-use token from a recent preview_tasks_batch call. Required. Tokens are bound to the preview that issued them and expire after 5 minutes.',
    ),
});

type Input = z.infer<typeof inputSchema>;

export interface CreatedBatchTaskRow {
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
  task_url: string;
}

export interface CreatedBatchBinRow {
  bin_id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  sort_order: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  bins_url: string;
}

export interface CreateTasksBatchData {
  /** Tasks that landed. May be shorter than the original input. */
  tasks: CreatedBatchTaskRow[];
  /**
   * The new sub-bin created at the start of the batch, when shared_bin
   * was new_sub_bin. Null otherwise.
   */
  created_bin: CreatedBatchBinRow | null;
  /**
   * Per-task failures, in input order. Empty when everything succeeded.
   * Each carries the original task index + title so the model can
   * narrate exactly which one failed.
   */
  failures: Array<{
    task_index: number;
    title: string;
    error: { code: string; message: string; field?: string };
  }>;
}

async function handler(input: Input): Promise<ToolResult<CreateTasksBatchData>> {
  const consumed = consumeCreateTasksBatchToken(input.confirmation_token);
  if (!consumed.ok) {
    const reason = consumed.reason;
    return {
      ok: false,
      error: {
        code: 'confirmation_required',
        message:
          reason === 'expired'
            ? 'The confirmation token has expired. Tokens are valid for 5 minutes.'
            : 'No matching confirmation token. Tokens are issued only by preview_tasks_batch and are single-use.',
        hint:
          'Call preview_tasks_batch with the batch fields, present the plan to the user, get explicit confirmation, then call create_tasks_batch with the new confirmation_token.',
      },
    };
  }

  const result = await createTasksBatchService(consumed.input);
  if (!result.ok) {
    if (result.error.code === 'invalid_input') {
      return {
        ok: false,
        error: {
          code: 'invalid_input',
          message: result.error.message,
          hint: 'Re-confirm the batch via preview_tasks_batch.',
        },
      };
    }
    if (result.error.code === 'duplicate_name') {
      return {
        ok: false,
        error: {
          code: 'duplicate_name',
          message: result.error.message,
          hint: 'Pick a different sub-bin name and run preview_tasks_batch again.',
        },
      };
    }
    if (result.error.code === 'not_found') {
      return {
        ok: false,
        error: {
          code: 'not_found',
          message: result.error.message,
          hint: 'A referenced row may have been deleted between preview and commit. Re-run preview_tasks_batch.',
        },
      };
    }
    return {
      ok: false,
      error: { code: 'db_error', message: result.error.message },
    };
  }

  // Project canonical CreatedTask rows onto the slim agent-facing shape
  // (mirrors the single-task create_task tool).
  const tasks: CreatedBatchTaskRow[] = result.result.tasks.map((t) => ({
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
  }));

  const createdBin: CreatedBatchBinRow | null = result.result.created_bin
    ? {
        bin_id: result.result.created_bin.id,
        name: result.result.created_bin.name,
        description: result.result.created_bin.description,
        is_system: result.result.created_bin.is_system,
        sort_order: result.result.created_bin.sort_order,
        created_by: result.result.created_bin.created_by,
        created_at: result.result.created_bin.created_at,
        updated_at: result.result.created_bin.updated_at,
        bins_url: binsIndexUrl(),
      }
    : null;

  const failures = result.result.failures.map((f: BatchTaskFailure) => ({
    task_index: f.task_index,
    title: f.title,
    error: {
      code: f.error.code,
      message: f.error.message,
      field: f.error.field,
    },
  }));

  const meta: ToolMeta = {
    returned: tasks.length,
    limit: 20,
    truncated: false,
    failed: failures.length,
    created_bin: createdBin !== null,
  };

  return {
    ok: true,
    data: { tasks, created_bin: createdBin, failures },
    meta,
  };
}

export const createTasksBatch: ToolDefinition<Input, CreateTasksBatchData> = {
  name: 'create_tasks_batch',
  description:
    "COMMIT a batch of tasks (and optionally a new sub-bin) that was previewed and confirmed by the user. Takes ONLY a confirmation_token from a recent preview_tasks_batch call. Returns the created tasks (with task_url for each), the new sub-bin if one was created (with bin_id and bins_url), AND a per-task failures list. PARTIAL FAILURES are possible: this tool may return ok:true with a non-empty failures array. When that happens, narrate the partial outcome honestly to the user (e.g. \"I created 4 of 5 tasks — task 5 (\\\"X\\\") failed because Y. Want me to retry just that one?\"). When ok:false, the entire batch failed before any tasks could be written; surface the error message.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      confirmation_token: {
        type: 'string',
        description:
          'Single-use token returned by preview_tasks_batch. Tokens expire 5 minutes after issuance.',
      },
    },
    required: ['confirmation_token'],
    additionalProperties: false,
  },
  handler,
};
