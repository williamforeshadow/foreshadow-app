import { z } from 'zod';
import {
  commitSlackFileAttachment,
  type SlackFileAttachmentPlan,
} from '@/src/server/slack/attachInboundFile';
import { consumeSlackFileAttachmentToken } from '@/src/server/slack/attachInboundFileConfirmation';
import type { ToolDefinition, ToolMeta, ToolResult } from './types';

const inputSchema = z.object({
  confirmation_token: z
    .string()
    .uuid()
    .describe(
      'Single-use token returned by preview_slack_file_attachment. Tokens expire after 5 minutes.',
    ),
});

type Input = z.infer<typeof inputSchema>;

export interface CommitSlackFileAttachmentData {
  plan: SlackFileAttachmentPlan;
  row: unknown;
}

async function handler(
  input: Input,
): Promise<ToolResult<CommitSlackFileAttachmentData>> {
  const consumed = consumeSlackFileAttachmentToken(input.confirmation_token);
  if (!consumed.ok) {
    return {
      ok: false,
      error: {
        code: 'confirmation_required',
        message:
          consumed.reason === 'expired'
            ? 'The confirmation token has expired. Tokens are valid for 5 minutes.'
            : 'No matching confirmation token. Tokens are issued only by preview_slack_file_attachment and are single-use.',
        hint:
          'Call preview_slack_file_attachment, present the plan to the user, get explicit confirmation, then call this tool with the new token.',
      },
    };
  }

  const result = await commitSlackFileAttachment(consumed.input);
  if (!result.ok) {
    return {
      ok: false,
      error: {
        code: result.error.code,
        message: result.error.message,
        hint: result.error.field
          ? `The "${result.error.field}" field is invalid. Re-run preview_slack_file_attachment.`
          : 'Re-run preview_slack_file_attachment.',
      },
    };
  }

  const meta: ToolMeta = { returned: 1, limit: 1, truncated: false };
  return { ok: true, data: { plan: result.plan, row: result.row }, meta };
}

export const commitSlackFileAttachmentTool: ToolDefinition<
  Input,
  CommitSlackFileAttachmentData
> = {
  name: 'commit_slack_file_attachment',
  description:
    'COMMIT a previewed-and-confirmed Slack inbound file attachment. Takes ONLY a confirmation_token from preview_slack_file_attachment. Use after the user explicitly confirms the preview plan.',
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      confirmation_token: {
        type: 'string',
        description:
          'Single-use token from preview_slack_file_attachment. Required.',
      },
    },
    required: ['confirmation_token'],
    additionalProperties: false,
  },
  handler,
};
