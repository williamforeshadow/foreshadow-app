import { z } from 'zod';
import {
  previewSlackFileAttachment,
  slackFileAttachmentInputSchema,
  type SlackFileAttachmentPlan,
} from '@/src/server/slack/attachInboundFile';
import { mintSlackFileAttachmentToken } from '@/src/server/slack/attachInboundFileConfirmation';
import type { ToolContext, ToolDefinition, ToolResult } from './types';

const inputSchema = slackFileAttachmentInputSchema;
type Input = z.infer<typeof inputSchema>;

export interface PreviewSlackFileAttachmentData {
  plan: SlackFileAttachmentPlan;
  confirmation_token: string;
  expires_at: string;
}

async function handler(
  input: Input,
  ctx: ToolContext,
): Promise<ToolResult<PreviewSlackFileAttachmentData>> {
  const enriched = {
    ...input,
    actor_user_id: ctx.actor?.appUserId ?? null,
    source: ctx.surface === 'slack' ? ('agent_slack' as const) : ('agent_web' as const),
  } as Input;

  const result = await previewSlackFileAttachment(enriched);
  if (!result.ok) {
    return {
      ok: false,
      error: {
        code: result.error.code,
        message: result.error.message,
        hint: result.error.field
          ? `Check the "${result.error.field}" field and call again.`
          : undefined,
      },
    };
  }

  const minted = mintSlackFileAttachmentToken(result.canonicalInput);
  return {
    ok: true,
    data: {
      plan: result.plan,
      confirmation_token: minted.token,
      expires_at: minted.expires_at,
    },
    meta: { returned: 1, limit: 1, truncated: false },
  };
}

export const previewSlackFileAttachmentTool: ToolDefinition<
  Input,
  PreviewSlackFileAttachmentData
> = {
  name: 'preview_slack_file_attachment',
  description:
    'PREVIEW attaching a Slack-uploaded inbound file to the app. Use inbound_file_id values from the Slack uploaded-files context. Destinations: task_attachment, property_document, property_room_photo, property_card_photo, property_tech_account_photo. Always preview, present the plan, get explicit confirmation, then call commit_slack_file_attachment with the returned token.',
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      destination: {
        type: 'string',
        enum: [
          'task_attachment',
          'property_document',
          'property_room_photo',
          'property_card_photo',
          'property_tech_account_photo',
        ],
        description:
          'Where to attach the Slack file: a task attachment, Property Knowledge document, room photo, card photo, or tech account photo.',
      },
      inbound_file_id: {
        type: 'string',
        description:
          'UUID from the Slack uploaded-files context block. Do not invent this id.',
      },
      task_id: {
        type: 'string',
        description:
          'Required for destination=task_attachment. Resolve with find_tasks.',
      },
      property_id: {
        type: 'string',
        description:
          'Required for Property Knowledge destinations. Resolve with find_properties.',
      },
      tag: {
        type: 'string',
        enum: ['lease', 'appliance_manual', 'inspection', 'insurance', 'other'],
        description:
          'For destination=property_document, document category. Defaults to other.',
      },
      title: {
        type: 'string',
        description:
          'Optional title for destination=property_document. Defaults to Slack file title/name.',
      },
      notes: {
        type: 'string',
        description: 'Optional notes for destination=property_document.',
      },
      room_id: {
        type: 'string',
        description:
          'Required for destination=property_room_photo. Get ids from get_property_knowledge.',
      },
      card_id: {
        type: 'string',
        description:
          'Required for destination=property_card_photo. Get ids from get_property_knowledge.',
      },
      account_id: {
        type: 'string',
        description:
          'Required for destination=property_tech_account_photo. Get ids from get_property_knowledge.',
      },
      caption: {
        type: 'string',
        description: 'Optional photo caption for room/card photo destinations.',
      },
    },
    required: ['destination', 'inbound_file_id'],
    additionalProperties: false,
  },
  handler,
};
