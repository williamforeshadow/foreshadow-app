import { z } from 'zod';
import {
  previewPropertyKnowledgeWrite,
  propertyKnowledgeWriteInputSchema,
  type PropertyKnowledgeWritePlan,
} from '@/src/server/properties/propertyKnowledgeWrite';
import { mintPropertyKnowledgeWriteToken } from '@/src/server/properties/propertyKnowledgeWriteConfirmation';
import { createPendingAction } from '@/src/server/agent/pendingActions';
import type { ToolContext, ToolDefinition, ToolResult } from './types';

const inputSchema = z
  .object({
    action: z.enum([
      'upsert_access',
      'upsert_connectivity',
      'upsert_room',
      'delete_room',
      'upsert_card',
      'delete_card',
      'update_document',
      'delete_document',
    ]),
    property_id: z.string().uuid(),
    room_id: z.string().uuid().optional(),
    card_id: z.string().uuid().optional(),
    document_id: z.string().uuid().optional(),
    fields: z.record(z.string(), z.unknown()).optional(),
    attachment_inbound_file_ids: z.array(z.string().uuid()).optional(),
    attachment_caption: z.string().nullable().optional(),
  })
  .passthrough();
type Input = z.infer<typeof inputSchema>;

export interface PreviewPropertyKnowledgeWriteData {
  plan: PropertyKnowledgeWritePlan;
  confirmation_token: string;
  expires_at: string;
  pending_action_id?: string | null;
}

async function handler(
  input: Input,
  ctx: ToolContext,
): Promise<ToolResult<PreviewPropertyKnowledgeWriteData>> {
  const {
    attachment_inbound_file_ids,
    attachment_caption,
    ...primaryInput
  } = input;
  if (
    attachment_inbound_file_ids?.length &&
    input.action !== 'upsert_card' &&
    input.action !== 'upsert_room'
  ) {
    return {
      ok: false,
      error: {
        code: 'invalid_input',
        message:
          'Slack file attachments on Property Knowledge compound writes are supported only for room or card photo destinations.',
      },
    };
  }

  const parsedPrimary = propertyKnowledgeWriteInputSchema.safeParse(primaryInput);
  if (!parsedPrimary.success) {
    const first = parsedPrimary.error.issues[0];
    return {
      ok: false,
      error: {
        code: 'invalid_input',
        message: first?.message ?? 'invalid input',
        hint: first?.path.join('.') || undefined,
      },
    };
  }

  const enriched = {
    ...parsedPrimary.data,
    actor_user_id: ctx.actor?.appUserId ?? null,
    source:
      ctx.surface === 'slack' ? ('agent_slack' as const) : ('agent_web' as const),
  };

  const result = await previewPropertyKnowledgeWrite(enriched);
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
  const minted = mintPropertyKnowledgeWriteToken(result.canonicalInput);
  const pendingActionId =
    ctx.surface === 'slack' && ctx.slack
      ? await createPendingAction({
          kind: 'property_knowledge_write',
          requesterAppUserId: ctx.actor?.appUserId ?? null,
          slack: ctx.slack,
          canonicalInput: {
            input: result.canonicalInput,
            attachment_inbound_file_ids: attachment_inbound_file_ids ?? [],
            attachment_caption: attachment_caption ?? null,
          },
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

export const previewPropertyKnowledgeWriteTool: ToolDefinition<
  Input,
  PreviewPropertyKnowledgeWriteData
> = {
  name: 'preview_property_knowledge_write',
  description:
    "PREVIEW writes to Property Knowledge sections that are not Information or Activity: Access, Connectivity, Interior/Exterior rooms, Interior/Exterior cards, and Document metadata/deletes. Use this for access codes, parking instructions, wifi/router details, creating/updating/deleting rooms, creating/updating/deleting room cards, and editing/deleting existing documents. It does NOT upload new document files, and it does NOT write property Information or Activity. Existing specialized tools still handle Notes and Vendor contacts. Required workflow: call this preview tool, present the plan/diff to the user, get explicit confirmation, then call commit_property_knowledge_write with the returned token. If plan.changes is empty on an update, tell the user nothing would change and do not commit.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: [
          'upsert_access',
          'upsert_connectivity',
          'upsert_room',
          'delete_room',
          'upsert_card',
          'delete_card',
          'update_document',
          'delete_document',
        ],
        description:
          'Which Property Knowledge write to preview. upsert_room/upsert_card create when id is omitted and update when id is supplied.',
      },
      property_id: {
        type: 'string',
        description: 'Property UUID. Resolve names with find_properties first.',
      },
      room_id: {
        type: 'string',
        description:
          'Room UUID for updating/deleting a room, or omitted when creating a room.',
      },
      card_id: {
        type: 'string',
        description:
          'Card UUID for updating/deleting a card, or omitted when creating a card.',
      },
      document_id: {
        type: 'string',
        description: 'Document UUID for metadata edits or deletion.',
      },
      fields: {
        type: 'object',
        description:
          "Fields for the selected action. Access fields include guest_code, cleaner_code, backup_code, code_rotation_notes, outer_door_code, gate_code, elevator_notes, unit_door_code, key_location, lockbox_code, parking_spot_number, parking_type, parking_instructions. Connectivity fields: wifi_ssid, wifi_password, wifi_router_location. Room fields: scope ('interior'|'exterior'), type, title, notes, sort_order. Card fields: room_id, tag, title, body, tag_data, sort_order. Document fields: title, notes, tag. Pass null to clear nullable text fields.",
      },
      attachment_inbound_file_ids: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Slack-only: inbound_file_id UUIDs to attach as photos after an upsert_room or upsert_card write. Use only ids from the Slack uploaded-files context block.',
      },
      attachment_caption: {
        type: 'string',
        description:
          'Optional caption to apply to room/card photos attached by attachment_inbound_file_ids.',
      },
    },
    required: ['action', 'property_id'],
    additionalProperties: false,
  },
  handler,
};
