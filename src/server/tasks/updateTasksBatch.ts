import { z } from 'zod';
import {
  previewUpdateTask,
  updateTask,
  updateTaskInputSchema,
  type UpdateTaskInput,
  type UpdateTaskPlan,
  type UpdateTaskResult,
} from './updateTask';

const inputSchema = z.object({
  tasks: z
    .array(updateTaskInputSchema)
    .min(1, 'tasks must contain at least one task')
    .max(20, 'tasks may contain at most 20 entries per batch'),
});

export type UpdateTasksBatchInput = z.infer<typeof inputSchema>;

export type UpdateTasksBatchErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'locked_field'
  | 'db_error';

export interface UpdateTasksBatchError {
  code: UpdateTasksBatchErrorCode;
  message: string;
  task_index?: number;
  field?: string;
}

export interface UpdateTasksBatchFailure {
  task_index: number;
  task_id: string;
  title: string | null;
  error: UpdateTasksBatchError;
}

export interface UpdateTasksBatchPlan {
  tasks: UpdateTaskPlan[];
  summary: string;
  change_count: number;
  no_op_count: number;
}

export type PreviewUpdateTasksBatchResult =
  | {
      ok: true;
      plan: UpdateTasksBatchPlan;
      canonicalInput: UpdateTasksBatchInput;
    }
  | { ok: false; error: UpdateTasksBatchError };

export interface UpdateTasksBatchResult {
  updated: Array<Extract<UpdateTaskResult, { ok: true }>>;
  skipped: UpdateTaskPlan[];
  failures: UpdateTasksBatchFailure[];
}

export type UpdateTasksBatchOutcome =
  | { ok: true; result: UpdateTasksBatchResult }
  | { ok: false; error: UpdateTasksBatchError };

function summarizePlan(plans: UpdateTaskPlan[]) {
  const changedTasks = plans.filter((plan) => plan.changes.length > 0);
  const changeCount = changedTasks.reduce(
    (sum, plan) => sum + plan.changes.length,
    0,
  );
  const noOpCount = plans.length - changedTasks.length;
  const summary =
    changedTasks.length === 0
      ? `No task updates needed across ${plans.length} task${plans.length === 1 ? '' : 's'}`
      : `Update ${changedTasks.length} of ${plans.length} task${plans.length === 1 ? '' : 's'} with ${changeCount} total change${changeCount === 1 ? '' : 's'}`;
  return { summary, changeCount, noOpCount };
}

function normalizeError(
  error: { code: string; message: string; field?: string },
  taskIndex: number,
): UpdateTasksBatchError {
  const code: UpdateTasksBatchErrorCode =
    error.code === 'not_found'
      ? 'not_found'
      : error.code === 'locked_field'
        ? 'locked_field'
        : error.code === 'db_error'
          ? 'db_error'
          : 'invalid_input';
  return {
    code,
    message: `Task ${taskIndex + 1}: ${error.message}`,
    task_index: taskIndex,
    field: error.field,
  };
}

export async function previewUpdateTasksBatch(
  rawInput: unknown,
): Promise<PreviewUpdateTasksBatchResult> {
  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: {
        code: 'invalid_input',
        message: first?.message ?? 'invalid input',
        field: first?.path?.join('.') || undefined,
      },
    };
  }

  const plans: UpdateTaskPlan[] = [];
  for (let i = 0; i < parsed.data.tasks.length; i++) {
    const result = await previewUpdateTask(parsed.data.tasks[i]);
    if (!result.ok) {
      return { ok: false, error: normalizeError(result.error, i) };
    }
    plans.push(result.plan);
  }

  const { summary, changeCount, noOpCount } = summarizePlan(plans);
  return {
    ok: true,
    plan: {
      tasks: plans,
      summary,
      change_count: changeCount,
      no_op_count: noOpCount,
    },
    canonicalInput: parsed.data,
  };
}

export async function updateTasksBatch(
  rawInput: unknown,
): Promise<UpdateTasksBatchOutcome> {
  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: {
        code: 'invalid_input',
        message: first?.message ?? 'invalid input',
        field: first?.path?.join('.') || undefined,
      },
    };
  }

  const updated: UpdateTasksBatchResult['updated'] = [];
  const skipped: UpdateTaskPlan[] = [];
  const failures: UpdateTasksBatchFailure[] = [];

  for (let i = 0; i < parsed.data.tasks.length; i++) {
    const input: UpdateTaskInput = parsed.data.tasks[i];
    const preview = await previewUpdateTask(input);
    if (!preview.ok) {
      failures.push({
        task_index: i,
        task_id: input.task_id,
        title: null,
        error: normalizeError(preview.error, i),
      });
      continue;
    }
    if (preview.plan.changes.length === 0) {
      skipped.push(preview.plan);
      continue;
    }

    const result = await updateTask(input);
    if (result.ok) {
      updated.push(result);
    } else {
      failures.push({
        task_index: i,
        task_id: input.task_id,
        title: preview.plan.current_title,
        error: normalizeError(result.error, i),
      });
    }
  }

  if (updated.length === 0 && skipped.length === 0) {
    return {
      ok: false,
      error: failures[0]?.error ?? {
        code: 'db_error',
        message: 'Batch failed: no tasks were updated.',
      },
    };
  }

  return { ok: true, result: { updated, skipped, failures } };
}
