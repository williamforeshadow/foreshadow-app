import { z } from 'zod';
import {
  commitAddCommentsBatch,
  type AddCommentsBatchCommitResult,
  type AddCommentsBatchPlan,
} from '@/src/server/comments/addCommentsBatch';
import { consumeAddCommentsBatchToken } from '@/src/server/comments/addCommentConfirmation';
import { requireOrgId, type ToolContext, type ToolDefinition, type ToolMeta, type ToolResult } from './types';

const inputSchema = z.object({
  confirmation_token: z
    .string()
    .uuid()
    .describe(
      'Single-use token returned by preview_comments_batch. Tokens expire after 5 minutes.',
    ),
});

type Input = z.infer<typeof inputSchema>;

export interface AddCommentsBatchData {
  plan: AddCommentsBatchPlan;
  results: AddCommentsBatchCommitResult[];
  failures: AddCommentsBatchCommitResult[];
}

async function handler(
  input: Input,
  ctx: ToolContext,
): Promise<ToolResult<AddCommentsBatchData>> {
  const org = requireOrgId(ctx);
  if (typeof org !== 'string') return org;

  const consumed = consumeAddCommentsBatchToken(input.confirmation_token);
  if (!consumed.ok) {
    return {
      ok: false,
      error: {
        code: 'confirmation_required',
        message:
          consumed.reason === 'expired'
            ? 'The confirmation token has expired. Tokens are valid for 5 minutes.'
            : 'No matching confirmation token. Tokens are issued only by preview_comments_batch and are single-use.',
        hint: 'Call preview_comments_batch, present the plan to the user, get explicit confirmation, then call this tool with the new token.',
      },
    };
  }

  const result = await commitAddCommentsBatch(consumed.input, org);
  if (!result.ok) {
    return {
      ok: false,
      error: {
        code: result.error.code,
        message: result.error.message,
        hint: 'Re-run preview_comments_batch.',
      },
    };
  }

  const meta: ToolMeta = {
    returned: result.results.length,
    limit: consumed.input.task_ids.length,
    truncated: false,
  };
  return {
    ok: true,
    data: { plan: result.plan, results: result.results, failures: result.failures },
    meta,
  };
}

export const addCommentsBatch: ToolDefinition<Input, AddCommentsBatchData> = {
  name: 'add_comments_batch',
  description:
    'COMMIT a previewed-and-confirmed comment BATCH. Takes ONLY a confirmation_token from preview_comments_batch (a preview_comment token is NOT accepted). Posts the same comment on every task in the batch, authored as the talking-to user. May return ok:true with a non-empty failures array when some comments landed and others did not — when that happens, say which tasks got the comment and which did not. Do not claim full success.',
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      confirmation_token: {
        type: 'string',
        description: 'Single-use token from preview_comments_batch. Required.',
      },
    },
    required: ['confirmation_token'],
    additionalProperties: false,
  },
  handler,
};
