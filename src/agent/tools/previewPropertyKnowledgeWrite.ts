import { z } from 'zod';
import {
  previewPropertyKnowledgeWrite,
  propertyKnowledgeWriteInputSchema,
  type PropertyKnowledgeWritePlan,
} from '@/src/server/properties/propertyKnowledgeWrite';
import { mintPropertyKnowledgeWriteToken } from '@/src/server/properties/propertyKnowledgeWriteConfirmation';
import type { ToolContext, ToolDefinition, ToolResult } from './types';

const inputSchema = propertyKnowledgeWriteInputSchema;
type Input = z.infer<typeof inputSchema>;

export interface PreviewPropertyKnowledgeWriteData {
  plan: PropertyKnowledgeWritePlan;
  confirmation_token: string;
  expires_at: string;
}

async function handler(
  input: Input,
  ctx: ToolContext,
): Promise<ToolResult<PreviewPropertyKnowledgeWriteData>> {
  const enriched = {
    ...input,
    actor_user_id: ctx.actor?.appUserId ?? null,
    source:
      ctx.surface === 'slack' ? ('agent_slack' as const) : ('agent_web' as const),
  } as Input;

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
    },
    required: ['action', 'property_id'],
    additionalProperties: false,
  },
  handler,
};
