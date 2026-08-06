import { z } from 'zod';
import {
  previewAddComment,
  type AddCommentPlan,
} from '@/src/server/comments/addComment';
import { mintAddCommentToken } from '@/src/server/comments/addCommentConfirmation';
import { maybeCreatePendingAction } from '@/src/server/agent/pendingActions';
import { requireOrgId, type ToolDefinition, type ToolContext, type ToolResult } from './types';

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
// Surface support: BOTH surfaces attribute comments correctly.
//   - Slack resolves the slack user → app user via email match before
//     runAgent fires.
//   - In-app web chat takes the verified Supabase session via
//     requireAuthContext (see app/api/agent/route.ts), which also rejects
//     the request outright when there's no signed-in, org-linked user.
// The actor guard below is therefore unreachable from either surface
// today. It stays because ToolContext.actor is optional — a future
// surface that forgets to resolve identity should fail loudly here
// rather than silently author a comment as nobody.

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
  const org = requireOrgId(ctx);
  if (typeof org !== 'string') return org;

  if (!ctx.actor) {
    return {
      ok: false,
      error: {
        code: 'invalid_input',
        message:
          'Cannot author a comment without a resolved actor. Comments are authored as the talking-to user; this surface did not resolve one.',
        hint:
          'This is a server-side configuration fault, not something the user can work around — a verified author is normally resolved before every run. Tell the user commenting is temporarily unavailable and report it. Do not suggest they post from somewhere else.',
      },
    };
  }

  const result = await previewAddComment({
    task_id: input.task_id,
    comment_content: input.comment_content,
    user_id: ctx.actor.appUserId,
  }, org);

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
  const pendingActionId = await maybeCreatePendingAction(ctx, {
    kind: 'add_comment',
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
