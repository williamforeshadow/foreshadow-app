import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabaseServer';

// Service: delete a task.
//
// Today this is a HARD DELETE — the row is removed from turnover_tasks
// (cascade-deletes task_assignments via FK; project_comments and
// project_attachments cascade on the task_id FK as well in the
// existing schema). Mirrors the UI's DELETE /api/tasks-for-bin/[id]
// route's behaviour.
//
// A soft-delete migration is on the roadmap (per the in-flight
// conversation about update tools). When that lands, this service
// switches from .delete() to an UPDATE setting deleted_at/archived
// without any change to the agent's tool surface — preview/commit
// tokens, errors, and the agent contract stay identical.

const inputSchema = z.object({
  task_id: z.string().uuid('task_id must be a valid UUID'),
});

export type DeleteTaskInput = z.infer<typeof inputSchema>;

export type DeleteTaskErrorCode = 'invalid_input' | 'not_found' | 'db_error';

export interface DeleteTaskError {
  code: DeleteTaskErrorCode;
  message: string;
  field?: string;
}

export interface DeletedTask {
  task_id: string;
  /** Snapshot of the row at delete time, for the "I deleted X" confirmation. */
  title: string;
  property_name: string | null;
  template_name: string | null;
  scheduled_date: string | null;
  status: string;
}

export type DeleteTaskResult =
  | { ok: true; deleted: DeletedTask }
  | { ok: false; error: DeleteTaskError };

type Supabase = ReturnType<typeof getSupabaseServer>;

interface ExistingTask {
  id: string;
  title: string;
  property_name: string | null;
  template_id: string | null;
  scheduled_date: string | null;
  status: string;
  template_name: string | null;
}

async function loadExistingTask(
  supabase: Supabase,
  taskId: string,
): Promise<ExistingTask | null> {
  const { data } = await supabase
    .from('turnover_tasks')
    .select(
      `id, title, property_name, template_id, scheduled_date, status,
       templates(name)`,
    )
    .eq('id', taskId)
    .maybeSingle();
  if (!data) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = data as any;
  return {
    id: row.id,
    title: row.title,
    property_name: row.property_name ?? null,
    template_id: row.template_id ?? null,
    scheduled_date: row.scheduled_date ?? null,
    status: row.status ?? 'not_started',
    template_name: row.templates?.name ?? null,
  };
}

/**
 * Hard-delete a task. Returns a snapshot of what was deleted so the
 * caller can confirm the outcome to the user without an additional
 * read. Returns not_found when the row is already gone (idempotent
 * from the agent's perspective — but the not_found error gives the
 * model the chance to correct its mental model: "wait, that task was
 * already deleted").
 */
export async function deleteTask(
  rawInput: unknown,
): Promise<DeleteTaskResult> {
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
  const input = parsed.data;
  const supabase = getSupabaseServer();

  const existing = await loadExistingTask(supabase, input.task_id);
  if (!existing) {
    return {
      ok: false,
      error: {
        code: 'not_found',
        message: `No row in turnover_tasks with id ${input.task_id} (passed as task_id).`,
        field: 'task_id',
      },
    };
  }

  const { error } = await supabase
    .from('turnover_tasks')
    .delete()
    .eq('id', input.task_id);
  if (error) {
    return {
      ok: false,
      error: { code: 'db_error', message: error.message },
    };
  }

  return {
    ok: true,
    deleted: {
      task_id: existing.id,
      title: existing.title,
      property_name: existing.property_name,
      template_name: existing.template_name,
      scheduled_date: existing.scheduled_date,
      status: existing.status,
    },
  };
}

// ---------- preview (no-write) ----------------------------------------------

export interface DeleteTaskPlan {
  task_id: string;
  title: string;
  property_name: string | null;
  template_name: string | null;
  scheduled_date: string | null;
  status: string;
  /**
   * Number of comments that will be cascade-deleted along with the task.
   * Surfaced so the agent can warn the user before they confirm.
   */
  comment_count: number;
  /**
   * Number of assignees who will lose this task from their queue.
   * Surfaced for the same reason as comment_count.
   */
  assignment_count: number;
  /** True when the task was created from a template (informational). */
  has_template: boolean;
}

export type PreviewDeleteTaskResult =
  | { ok: true; plan: DeleteTaskPlan; canonicalInput: DeleteTaskInput }
  | { ok: false; error: DeleteTaskError };

/**
 * Look up the task and surface the impact of deleting it (comment count,
 * assignment count) WITHOUT writing. Mirrors deleteTask's not_found
 * surface so the agent gets the same loud signal at preview time.
 */
export async function previewDeleteTask(
  rawInput: unknown,
): Promise<PreviewDeleteTaskResult> {
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
  const input = parsed.data;
  const supabase = getSupabaseServer();

  const existing = await loadExistingTask(supabase, input.task_id);
  if (!existing) {
    return {
      ok: false,
      error: {
        code: 'not_found',
        message: `No row in turnover_tasks with id ${input.task_id} (passed as task_id).`,
        field: 'task_id',
      },
    };
  }

  // Cascade impact counts. We use head:true / count:'exact' to avoid
  // pulling rows we don't need.
  const [commentRes, assignmentRes] = await Promise.all([
    supabase
      .from('project_comments')
      .select('id', { count: 'exact', head: true })
      .eq('task_id', input.task_id),
    supabase
      .from('task_assignments')
      .select('user_id', { count: 'exact', head: true })
      .eq('task_id', input.task_id),
  ]);

  const commentCount = commentRes.count ?? 0;
  const assignmentCount = assignmentRes.count ?? 0;

  return {
    ok: true,
    plan: {
      task_id: existing.id,
      title: existing.title,
      property_name: existing.property_name,
      template_name: existing.template_name,
      scheduled_date: existing.scheduled_date,
      status: existing.status,
      comment_count: commentCount,
      assignment_count: assignmentCount,
      has_template: existing.template_id != null,
    },
    canonicalInput: input,
  };
}
