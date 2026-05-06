import { z } from 'zod';
import { addComment as addCommentService } from '@/src/server/comments/addComment';
import { consumeAddCommentToken } from '@/src/server/comments/addCommentConfirmation';
import type { ToolDefinition, ToolMeta, ToolResult } from './types';

// add_comment — second half of the two-step write protocol for task
// comments. Accepts ONLY a confirmation_token from preview_comment.
// Mirrors create_task / create_bin in shape — the model has no surface
// to author a comment without first running preview, and the canonical
// input (including the actor-bound user_id) was locked in at preview
// time so the model can't swap fields between the two steps.

const inputSchema = z.object({
  confirmation_token: z
    .string()
    .uuid()
    .describe(
      'Single-use token from a recent preview_comment call. Required. Tokens expire 5 minutes after issuance.',
    ),
});

type Input = z.infer<typeof inputSchema>;

export interface AddedCommentRow {
  comment_id: string;
  task_id: string;
  user_id: string;
  user_name: string | null;
  comment_content: string;
  created_at: string;
}

async function handler(input: Input): Promise<ToolResult<AddedCommentRow>> {
  const consumed = consumeAddCommentToken(input.confirmation_token);
  if (!consumed.ok) {
    return {
      ok: false,
      error: {
        code: 'confirmation_required',
        message:
          consumed.reason === 'expired'
            ? 'The confirmation token has expired. Tokens are valid for 5 minutes.'
            : 'No matching confirmation token. Tokens are issued only by preview_comment and are single-use.',
        hint:
          'Call preview_comment with task_id and comment_content, present the plan to the user, get explicit confirmation, then call add_comment with the new confirmation_token.',
      },
    };
  }

  const result = await addCommentService(consumed.input);
  if (!result.ok) {
    if (result.error.code === 'invalid_input') {
      return {
        ok: false,
        error: {
          code: 'invalid_input',
          message: result.error.message,
          hint: result.error.field
            ? `The "${result.error.field}" field is invalid. Re-confirm via preview_comment.`
            : 'Re-confirm the comment via preview_comment.',
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
            'A referenced row may have been deleted between preview and commit. Re-run preview_comment.',
        },
      };
    }
    return {
      ok: false,
      error: { code: 'db_error', message: result.error.message },
    };
  }

  const meta: ToolMeta = { returned: 1, limit: 1, truncated: false };
  return { ok: true, data: result.comment, meta };
}

export const addComment: ToolDefinition<Input, AddedCommentRow> = {
  name: 'add_comment',
  description:
    "COMMIT a comment that was previewed and confirmed. Takes ONLY a confirmation_token from a recent preview_comment call — comment fields are not accepted here; they were locked in when the token was minted. Required workflow: 1) call preview_comment with task_id + comment_content → get a plan + token, 2) present the plan to the user and ask for explicit confirmation, 3) only after the user confirms, call this tool with the token. Returns the inserted comment on success, or confirmation_required if the token is missing/expired/already-used. After a successful add, confirm to the user using the returned content and timestamp.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      confirmation_token: {
        type: 'string',
        description:
          'Single-use token returned by preview_comment. Tokens expire 5 minutes after issuance. Required.',
      },
    },
    required: ['confirmation_token'],
    additionalProperties: false,
  },
  handler,
};
