import { z } from 'zod';
import {
  previewAddComment,
  type AddCommentPlan,
} from '@/src/server/comments/addComment';
import { mintAddCommentToken } from '@/src/server/comments/addCommentConfirmation';
import { createPendingAction } from '@/src/server/agent/pendingActions';
import type { ToolDefinition, ToolContext, ToolResult } from './types';

// preview_comment — first half of the two-step write protocol for task
// comments. Mirrors preview_task in shape: validates, resolves display
// labels (task title/property, author name), returns a plan + a single-
// use confirmation_token that add_comment consumes.
//
// Authorship binding (critical):
//   The author user_id is taken from ctx.actor server-side. The model
//   does NOT supply a user_id — there is no input field for it. This
//   prevents the model from authoring as anyone other than the talking-
//   to user, even on prompt injection / fabrication paths.
//
// Surface where this matters:
//   - Slack: the Slack route resolves the slack user → app user via
//     email match before runAgent fires. Comments authored from Slack
//     are reliably attributed to the right person.
//   - In-app web chat: the actor binding is currently weak (any logged-
//     in user is whoever's selected in the AuthProvider dropdown — see
//     runAgent.ts). When ctx.actor is missing, we refuse to author the
//     comment and return a clear error so the model can tell the user
//     why.

const inputSchema = z.object({
  task_id: z
    .string()
    .uuid()
    .describe(
      'UUID of the task to comment on. Resolve task ids via find_tasks first when the user names a task.',
    ),
  comment_content: z
    .string()
    .min(1, 'comment_content is required')
    .max(4000, 'comment_content must be 4000 characters or fewer')
    .describe(
      "Plain-text comment body. Multi-line supported (line breaks render as-is). Don't include markdown or rich-text — the comment column is plain text.",
    ),
});

type Input = z.infer<typeof inputSchema>;

export interface PreviewCommentResultData {
  plan: AddCommentPlan;
  confirmation_token: string;
  expires_at: string;
  pending_action_id?: string | null;
}

async function handler(
  input: Input,
  ctx: ToolContext,
): Promise<ToolResult<PreviewCommentResultData>> {
  if (!ctx.actor) {
    return {
      ok: false,
      error: {
        code: 'invalid_input',
        message:
          'Cannot author a comment without a resolved actor. Comments are authored as the talking-to user; this surface does not have one.',
        hint:
          'Tell the user that comment-adding is only available where the conversation has a verified author (currently Slack). Suggest they post the comment from Slack instead.',
      },
    };
  }

  const result = await previewAddComment({
    task_id: input.task_id,
    comment_content: input.comment_content,
    user_id: ctx.actor.appUserId,
  });

  if (!result.ok) {
    if (result.error.code === 'invalid_input') {
      return {
        ok: false,
        error: {
          code: 'invalid_input',
          message: result.error.message,
          hint: result.error.field
            ? `Check the "${result.error.field}" field and call again.`
            : undefined,
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
            result.error.field === 'task_id'
              ? 'Call find_tasks to resolve a task by title/template/property and use the returned task_id.'
              : 'The comment author user_id is no longer valid. This is unusual — try again, and if it persists, the actor account may have been removed.',
        },
      };
    }
    return {
      ok: false,
      error: { code: 'db_error', message: result.error.message },
    };
  }

  const minted = mintAddCommentToken(result.canonicalInput);
  const pendingActionId =
    ctx.surface === 'slack' && ctx.slack
      ? await createPendingAction({
          kind: 'add_comment',
          requesterAppUserId: ctx.actor.appUserId,
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
    meta: { returned: 1, limit: 1, truncated: false },
  };
}

export const previewComment: ToolDefinition<Input, PreviewCommentResultData> = {
  name: 'preview_comment',
  description:
    "PREVIEW a comment on a task before posting it. ALWAYS call this first when the user asks to add a comment, leave a note, or ping someone on a task. Validates the task and your author identity, returns a plan (task title/property + author name + a 200-char preview of the comment) and a confirmation_token. Authorship is bound server-side to the talking-to user — DO NOT attempt to specify the author; there is no input field for it. After calling: present the plan to the user in plain English, ask for explicit confirmation ('shall I post this comment?'), and only then call add_comment with the token. Tokens are single-use and expire in 5 minutes. preview_comment never writes; safe to call repeatedly while wording the comment with the user.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      task_id: {
        type: 'string',
        description:
          'Task UUID to attach the comment to. Resolve task ids with find_tasks first when the user names a task.',
      },
      comment_content: {
        type: 'string',
        minLength: 1,
        maxLength: 4000,
        description:
          'Plain-text comment body. Multi-line supported. No markdown / rich-text — the column is plain text.',
      },
    },
    required: ['task_id', 'comment_content'],
    additionalProperties: false,
  },
  handler,
};
