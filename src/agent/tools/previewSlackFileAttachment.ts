import { z } from 'zod';
import {
  previewSlackFileAttachment,
  slackFileAttachmentInputSchema,
  type SlackFileAttachmentPlan,
} from '@/src/server/slack/attachInboundFile';
import { mintSlackFileAttachmentToken } from '@/src/server/slack/attachInboundFileConfirmation';
import { maybeCreatePendingAction } from '@/src/server/agent/pendingActions';
import { requireOrgId, type ToolContext, type ToolDefinition, type ToolResult } from './types';

const inputSchema = slackFileAttachmentInputSchema;
type Input = z.infer<typeof inputSchema>;

export interface PreviewSlackFileAttachmentData {
  plan: SlackFileAttachmentPlan;
  confirmation_token: string;
  expires_at: string;
  pending_action_id?: string | null;
}

async function handler(
  input: Input,
  ctx: ToolContext,
): Promise<ToolResult<PreviewSlackFileAttachmentData>> {
  // Org guard: the attachment service is org-blind and every target id is
  // model-supplied — validate the top-level target (task or property) belongs
  // to the caller's org BEFORE previewing. Child ids (room/attribute/account)
  // are constrained to the validated property inside the service. The commit
  // tool only accepts tokens minted here, so this covers commits too.
  const org = requireOrgId(ctx);
  if (typeof org !== 'string') return org;
  if (input.destination === 'task_attachment') {
    const { data: taskRow, error: taskErr } = await ctx.db
      .from('turnover_tasks')
      .select('id')
      .eq('id', input.task_id)
      .eq('org_id', org)
      .maybeSingle();
    if (taskErr) {
      return { ok: false, error: { code: 'db_error', message: taskErr.message } };
    }
    if (!taskRow) {
      return {
        ok: false,
        error: {
          code: 'not_found',
          message: `No task found with id ${input.task_id}.`,
          hint: 'Call find_tasks to resolve the task first.',
        },
      };
    }
  } else {
    const { data: propRow, error: propErr } = await ctx.db
      .from('properties')
      .select('id')
      .eq('id', input.property_id)
      .eq('org_id', org)
      .maybeSingle();
    if (propErr) {
      return { ok: false, error: { code: 'db_error', message: propErr.message } };
    }
    if (!propRow) {
      return {
        ok: false,
        error: {
          code: 'not_found',
          message: `No property found with id ${input.property_id}.`,
          hint: 'Call find_properties to resolve a property name into a valid id.',
        },
      };
    }
  }

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
  const pendingActionId = await maybeCreatePendingAction(ctx, {
    kind: 'slack_file_attachment',
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

export const previewSlackFileAttachmentTool: ToolDefinition<
  Input,
  PreviewSlackFileAttachmentData
> = {
  name: 'preview_slack_file_attachment',
  description:
    'PREVIEW attaching a Slack-uploaded inbound file to the app. Use inbound_file_id values from the Slack uploaded-files context. Destinations: task_attachment, property_document, property_room_photo, property_attribute_photo, property_tech_account_photo. Always preview, present the plan, get explicit confirmation, then call commit_slack_file_attachment with the returned token.',
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
          'property_attribute_photo',
          'property_tech_account_photo',
        ],
        description:
          'Where to attach the Slack file: a task attachment, Property Knowledge document, room photo, attribute photo, or tech account photo.',
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
      attribute_id: {
        type: 'string',
        description:
          'Required for destination=property_attribute_photo. Get ids from get_property_knowledge.',
      },
      account_id: {
        type: 'string',
        description:
          'Required for destination=property_tech_account_photo. Get ids from get_property_knowledge.',
      },
      caption: {
        type: 'string',
        description: 'Optional photo caption for room/attribute photo destinations.',
      },
    },
    required: ['destination', 'inbound_file_id'],
    additionalProperties: false,
  },
  handler,
};
