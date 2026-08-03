import { z } from 'zod';
import {
  previewAddComment,
  addComment,
  type AddCommentError,
  type AddCommentPlan,
} from './addComment';

// Batch task comments — "leave this note on all of these tasks".
//
// The single-comment engine takes one task_id, so "tell everyone the vendor is
// coming Tuesday" across five tasks meant five previews and a five-line plan for
// one sentence of intent.
//
// Layered on the existing engine: every comment still goes through
// previewAddComment / addComment, so validation, task resolution, and the
// server-side authorship binding are unchanged. Authorship in particular is NOT
// relaxed here — the author is still the talking-to user, passed in by the tool
// from ToolContext, never by the model.
//
// Unlike the property batches there is no name matching to do: task_ids are
// supplied directly, resolved by find_tasks. Note this means the operation is
// NOT idempotent — running it twice posts two comments, exactly as calling the
// single tool twice would. Comments are append-only by nature; there is no
// "already correct" state to detect.

const MAX_TASKS = 25;

export const addCommentsBatchInputSchema = z.object({
  task_ids: z.array(z.string().uuid()).min(1).max(MAX_TASKS),
  comment_content: z.string().min(1).max(4000),
  /** Bound server-side from the actor; never model-supplied. */
  user_id: z.string().uuid(),
});

export type AddCommentsBatchInput = z.infer<typeof addCommentsBatchInputSchema>;

export interface AddCommentsBatchStep {
  task_id: string;
  task_title: string | null;
  property_name: string | null;
}

export interface AddCommentsBatchFailure {
  task_id: string;
  error: AddCommentError;
}

export interface AddCommentsBatchPlan {
  author: AddCommentPlan['author'];
  comment_preview: string;
  comment_length: number;
  steps: AddCommentsBatchStep[];
  failures: AddCommentsBatchFailure[];
  summary: string;
}

export type PreviewAddCommentsBatchResult =
  | { ok: true; plan: AddCommentsBatchPlan; canonicalInput: AddCommentsBatchInput }
  | { ok: false; error: AddCommentError };

export interface AddCommentsBatchCommitResult {
  task_id: string;
  task_title: string | null;
  ok: boolean;
  row: unknown;
  error?: AddCommentError;
}

export type CommitAddCommentsBatchResult =
  | {
      ok: true;
      plan: AddCommentsBatchPlan;
      results: AddCommentsBatchCommitResult[];
      failures: AddCommentsBatchCommitResult[];
    }
  | { ok: false; error: AddCommentError };

export async function previewAddCommentsBatch(
  rawInput: unknown,
  orgId: string,
): Promise<PreviewAddCommentsBatchResult> {
  const parsed = addCommentsBatchInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: {
        code: 'invalid_input',
        message: first?.message ?? 'invalid input',
        field: first?.path.join('.') || undefined,
      },
    };
  }
  const input = parsed.data;

  const steps: AddCommentsBatchStep[] = [];
  const failures: AddCommentsBatchFailure[] = [];
  let author: AddCommentPlan['author'] | null = null;
  let commentPreview = '';
  let commentLength = 0;

  // Duplicate task ids would post the same comment twice on one task; the user
  // asked for one note per task, so collapse them.
  const uniqueTaskIds = [...new Set(input.task_ids)];

  for (const taskId of uniqueTaskIds) {
    const preview = await previewAddComment(
      {
        task_id: taskId,
        comment_content: input.comment_content,
        user_id: input.user_id,
      },
      orgId,
    );
    if (!preview.ok) {
      failures.push({ task_id: taskId, error: preview.error });
      continue;
    }
    author ??= preview.plan.author;
    commentPreview = preview.plan.comment_preview;
    commentLength = preview.plan.comment_length;
    steps.push({
      task_id: taskId,
      task_title: preview.plan.task.title,
      property_name: preview.plan.task.property_name,
    });
  }

  if (steps.length === 0 || !author) {
    return {
      ok: false,
      error: {
        code: failures[0]?.error.code ?? 'invalid_input',
        message:
          failures.length > 0
            ? `No task in the batch can be commented on. First problem: ${failures[0].error.message}`
            : 'The batch resolved to no comments.',
        field: failures[0]?.error.field,
      },
    };
  }

  const blockedText =
    failures.length > 0 ? `, ${failures.length} blocked` : '';
  return {
    ok: true,
    plan: {
      author,
      comment_preview: commentPreview,
      comment_length: commentLength,
      steps,
      failures,
      summary: `Post the same comment on ${steps.length} task${steps.length === 1 ? '' : 's'} as ${author.name}${blockedText}`,
    },
    canonicalInput: { ...input, task_ids: uniqueTaskIds },
  };
}

export async function commitAddCommentsBatch(
  rawInput: unknown,
  orgId: string,
): Promise<CommitAddCommentsBatchResult> {
  const preview = await previewAddCommentsBatch(rawInput, orgId);
  if (!preview.ok) return { ok: false, error: preview.error };
  const input = preview.canonicalInput;

  const results: AddCommentsBatchCommitResult[] = [];
  for (const step of preview.plan.steps) {
    const res = await addComment(
      {
        task_id: step.task_id,
        comment_content: input.comment_content,
        user_id: input.user_id,
      },
      orgId,
    );
    results.push({
      task_id: step.task_id,
      task_title: step.task_title,
      ok: res.ok,
      row: res.ok ? res.comment : null,
      ...(res.ok ? {} : { error: res.error }),
    });
  }

  return {
    ok: true,
    plan: preview.plan,
    results: results.filter((r) => r.ok),
    failures: results.filter((r) => !r.ok),
  };
}
