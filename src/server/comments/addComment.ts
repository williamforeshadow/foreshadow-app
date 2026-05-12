import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { notifyTaskCommented } from '@/src/server/notifications/notify';

// Service: add a comment to a task.
//
// Mirrors the createTask service's split between the canonical service
// and the agent's preview/commit token dance (see previewComment /
// addComment tools). The HTTP route at /api/project-comments POST
// accepts both project_id and task_id; this service is task-scoped only
// because that's the surface the agent operates on. Project comments
// stay on the HTTP route until a project-scoped agent tool exists.
//
// What this service deliberately does NOT do:
//   - log activity (the existing /api/project-comments route does so for
//     project comments only — task comments don't have an activity log
//     yet, matching the existing route's behaviour at line 95)
//   - resolve mentions, thread replies, or any rich-text features. The
//     comment_content column is plain text, rendered with whitespace-
//     pre-wrap by the UI; that's the contract this service preserves.
//
// Authorship binding:
//   - The author user_id is REQUIRED and FK-validated. The agent tool
//     reads the actor user_id from the per-run ToolContext rather than
//     accepting it as model input — the model has no way to author a
//     comment as a user other than the talking-to user.

const inputSchema = z.object({
  task_id: z
    .string()
    .uuid()
    .describe('UUID of the task the comment is being attached to.'),
  user_id: z
    .string()
    .uuid()
    .describe(
      'UUID of the comment author. Bound by the caller — agent tools pull this from the resolved actor, not from model input.',
    ),
  comment_content: z
    .string()
    .min(1, 'comment_content cannot be empty')
    .max(4000, 'comment_content must be 4000 characters or fewer')
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, 'comment_content cannot be only whitespace'),
});

export type AddCommentInput = z.infer<typeof inputSchema>;

export type AddCommentErrorCode = 'invalid_input' | 'not_found' | 'db_error';

export interface AddCommentError {
  code: AddCommentErrorCode;
  message: string;
  field?: string;
}

export interface AddedComment {
  comment_id: string;
  task_id: string;
  user_id: string;
  user_name: string | null;
  comment_content: string;
  created_at: string;
}

export type AddCommentResult =
  | { ok: true; comment: AddedComment }
  | { ok: false; error: AddCommentError };

type Supabase = ReturnType<typeof getSupabaseServer>;

interface FkLookup<T> {
  ok: true;
  value: T;
}

interface FkMiss {
  ok: false;
  error: AddCommentError;
}

async function loadTask(
  supabase: Supabase,
  taskId: string,
): Promise<FkLookup<{ id: string; title: string | null; property_name: string | null }> | FkMiss> {
  const { data, error } = await supabase
    .from('turnover_tasks')
    .select('id, title, property_name')
    .eq('id', taskId)
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      error: { code: 'db_error', message: error.message, field: 'task_id' },
    };
  }
  if (!data) {
    return {
      ok: false,
      error: {
        code: 'not_found',
        message: `No row in turnover_tasks with id ${taskId} (passed as task_id).`,
        field: 'task_id',
      },
    };
  }
  return {
    ok: true,
    value: data as { id: string; title: string | null; property_name: string | null },
  };
}

async function loadUser(
  supabase: Supabase,
  userId: string,
): Promise<FkLookup<{ id: string; name: string }> | FkMiss> {
  const { data, error } = await supabase
    .from('users')
    .select('id, name')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      error: { code: 'db_error', message: error.message, field: 'user_id' },
    };
  }
  if (!data) {
    return {
      ok: false,
      error: {
        code: 'not_found',
        message: `No row in users with id ${userId} (passed as user_id).`,
        field: 'user_id',
      },
    };
  }
  return { ok: true, value: data as { id: string; name: string } };
}

/**
 * Insert a new comment row tied to a task. Returns the inserted row in
 * the canonical AddedComment shape. The author user_id is FK-validated
 * (loud not_found instead of opaque Postgres FK violation), and the task
 * is FK-validated for the same reason — and to surface a friendly error
 * if the task was deleted between preview and commit.
 */
export async function addComment(rawInput: unknown): Promise<AddCommentResult> {
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

  // FK pre-validation. Both lookups in parallel so the round-trip cost
  // stays at one wall-clock query.
  const [taskLookup, userLookup] = await Promise.all([
    loadTask(supabase, input.task_id),
    loadUser(supabase, input.user_id),
  ]);
  if (!taskLookup.ok) return { ok: false, error: taskLookup.error };
  if (!userLookup.ok) return { ok: false, error: userLookup.error };

  const { data: inserted, error: insertError } = await supabase
    .from('project_comments')
    .insert({
      task_id: input.task_id,
      user_id: input.user_id,
      comment_content: input.comment_content,
    })
    .select('id, task_id, user_id, comment_content, created_at')
    .single();

  if (insertError || !inserted) {
    return {
      ok: false,
      error: {
        code: 'db_error',
        message: insertError?.message ?? 'insert returned no row',
      },
    };
  }

  const row = inserted as {
    id: string;
    task_id: string;
    user_id: string;
    comment_content: string;
    created_at: string;
  };

  await notifyTaskCommented({
    taskId: row.task_id,
    commentId: row.id,
    actor: { user_id: row.user_id, name: userLookup.value.name },
    commentPreview: row.comment_content,
  });

  return {
    ok: true,
    comment: {
      comment_id: row.id,
      task_id: row.task_id,
      user_id: row.user_id,
      user_name: userLookup.value.name,
      comment_content: row.comment_content,
      created_at: row.created_at,
    },
  };
}

// ---------- preview (no-write) ----------------------------------------------

export interface AddCommentPlan {
  task: { task_id: string; title: string | null; property_name: string | null };
  author: { user_id: string; name: string };
  /** Truncated preview of the comment text for display in the plan. */
  comment_preview: string;
  /** Length of the full comment_content (so the plan can say "120 chars"). */
  comment_length: number;
}

export type PreviewAddCommentResult =
  | { ok: true; plan: AddCommentPlan; canonicalInput: AddCommentInput }
  | { ok: false; error: AddCommentError };

/**
 * Validate inputs and resolve display labels WITHOUT writing. Mirrors
 * addComment's validation surface so any input that previews
 * successfully will also write successfully (modulo the comment row's
 * task or user being deleted in the 5-minute window).
 */
export async function previewAddComment(
  rawInput: unknown,
): Promise<PreviewAddCommentResult> {
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

  const [taskLookup, userLookup] = await Promise.all([
    loadTask(supabase, input.task_id),
    loadUser(supabase, input.user_id),
  ]);
  if (!taskLookup.ok) return { ok: false, error: taskLookup.error };
  if (!userLookup.ok) return { ok: false, error: userLookup.error };

  const preview =
    input.comment_content.length <= 200
      ? input.comment_content
      : input.comment_content.slice(0, 197) + '...';

  return {
    ok: true,
    plan: {
      task: {
        task_id: taskLookup.value.id,
        title: taskLookup.value.title,
        property_name: taskLookup.value.property_name,
      },
      author: {
        user_id: userLookup.value.id,
        name: userLookup.value.name,
      },
      comment_preview: preview,
      comment_length: input.comment_content.length,
    },
    canonicalInput: input,
  };
}
