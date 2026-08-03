import { z } from 'zod';
import {
  previewAddCommentsBatch,
  type AddCommentsBatchPlan,
} from '@/src/server/comments/addCommentsBatch';
import { mintAddCommentsBatchToken } from '@/src/server/comments/addCommentConfirmation';
import { maybeCreatePendingAction } from '@/src/server/agent/pendingActions';
import { requireOrgId, type ToolContext, type ToolDefinition, type ToolResult } from './types';

// preview_comments_batch — the same comment on several tasks, under one
// confirmation. Authorship is bound server-side to the talking-to user exactly
// as in preview_comment: there is no author input field, and the batch does not
// relax that.

const inputSchema = z.object({
  task_ids: z.array(z.string().uuid()).min(1).max(25),
  comment_content: z.string().min(1).max(4000),
});

type Input = z.infer<typeof inputSchema>;

export interface PreviewCommentsBatchData {
  plan: AddCommentsBatchPlan;
  confirmation_token: string;
  expires_at: string;
  pending_action_id?: string | null;
}

async function handler(
  input: Input,
  ctx: ToolContext,
): Promise<ToolResult<PreviewCommentsBatchData>> {
  const org = requireOrgId(ctx);
  if (typeof org !== 'string') return org;

  if (!ctx.actor) {
    return {
      ok: false,
      error: {
        code: 'invalid_input',
        message:
          'Cannot author comments without a resolved actor. Comments are authored as the talking-to user; this surface did not resolve one.',
        hint: 'This is a server-side configuration fault. Tell the user commenting is temporarily unavailable and report it.',
      },
    };
  }

  const result = await previewAddCommentsBatch(
    {
      task_ids: input.task_ids,
      comment_content: input.comment_content,
      user_id: ctx.actor.appUserId,
    },
    org,
  );
  if (!result.ok) {
    return {
      ok: false,
      error: {
        code: result.error.code === 'db_error' ? 'db_error' : result.error.code,
        message: result.error.message,
        hint:
          result.error.field === 'task_ids' || result.error.code === 'not_found'
            ? 'Call find_tasks to resolve the tasks and use the returned task_ids.'
            : undefined,
      },
    };
  }

  const minted = mintAddCommentsBatchToken(result.canonicalInput);
  const pendingActionId = await maybeCreatePendingAction(ctx, {
    kind: 'add_comments_batch',
    canonicalInput: { input: result.canonicalInput },
    preview: result.plan,
  });

  return {
    ok: true,
    data: {
      plan: result.plan,
      confirmation_token: minted.token,
      expires_at: minted.expires_at,
      pending_action_id: pendingActionId,
    },
    meta: {
      returned: result.plan.steps.length,
      limit: 25,
      truncated: false,
    },
  };
}

export const previewCommentsBatch: ToolDefinition<Input, PreviewCommentsBatchData> = {
  name: 'preview_comments_batch',
  description:
    "PREVIEW posting the SAME comment on MULTIPLE tasks at once — one plan, one confirmation, one click. Use this instead of looping preview_comment whenever the user wants one note on more than one task (e.g. 'tell everyone the vendor is coming Tuesday', 'note on all the La Mesa turnovers that the code changed'). Resolve the tasks with find_tasks first and pass their task_ids. Authorship is bound server-side to the talking-to user — there is no author field. The plan lists every task the comment will land on plus a `failures` array for ids that could not be resolved; present those honestly. NOTE: comments are append-only, so this is NOT idempotent — running it twice posts the comment twice. Do not re-run it to 'make sure'. Then call add_comments_batch with the token. For a comment on ONE task, use preview_comment.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      task_ids: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 25,
        description:
          'Task UUIDs to comment on (1-25). Resolve with find_tasks first. Duplicates are collapsed so a task never gets the same comment twice.',
      },
      comment_content: {
        type: 'string',
        minLength: 1,
        maxLength: 4000,
        description:
          'Plain-text comment body, posted verbatim on every task listed. Multi-line supported. No markdown — the column is plain text.',
      },
    },
    required: ['task_ids', 'comment_content'],
    additionalProperties: false,
  },
  handler,
};
