import { z } from 'zod';
import {
  previewPropertyKnowledgeOperations,
  propertyKnowledgeOperationSchema,
  MAX_OPERATIONS,
  type PropertyKnowledgeOperationsPlan,
} from '@/src/server/properties/propertyKnowledgeOperations';
import { mintPropertyKnowledgeWriteToken } from '@/src/server/properties/propertyKnowledgeWriteConfirmation';
import { maybeCreatePendingAction } from '@/src/server/agent/pendingActions';
import { requireOrgId, type ToolContext, type ToolDefinition, type ToolResult } from './types';

const inputSchema = z
  .object({
    property_id: z.string().uuid(),
    operations: z.array(propertyKnowledgeOperationSchema).min(1).max(MAX_OPERATIONS),
  })
  .passthrough();
type Input = z.infer<typeof inputSchema>;

export interface PreviewPropertyKnowledgeWriteData {
  plan: PropertyKnowledgeOperationsPlan;
  confirmation_token: string;
  expires_at: string;
  pending_action_id?: string | null;
}

async function handler(
  input: Input,
  ctx: ToolContext,
): Promise<ToolResult<PreviewPropertyKnowledgeWriteData>> {
  // Org guard: the operations service is org-blind and property_id is
  // model-supplied, so validate the property belongs to the caller's org BEFORE
  // previewing. The commit tool only accepts tokens minted here, so this covers
  // commits too; the pending-action executor re-checks at click time.
  const org = requireOrgId(ctx);
  if (typeof org !== 'string') return org;
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

  const result = await previewPropertyKnowledgeOperations({
    property_id: input.property_id,
    operations: input.operations,
    actor_user_id: ctx.actor?.appUserId ?? null,
    source: ctx.surface === 'slack' ? 'agent_slack' : 'agent_web',
  });
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
  const pendingActionId = await maybeCreatePendingAction(ctx, {
    kind: 'property_knowledge_write',
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
      returned: result.plan.operations.length,
      limit: MAX_OPERATIONS,
      truncated: false,
    },
  };
}

export const previewPropertyKnowledgeWriteTool: ToolDefinition<
  Input,
  PreviewPropertyKnowledgeWriteData
> = {
  name: 'preview_property_knowledge_write',
  description:
    "PREVIEW any number of Property Knowledge writes on ONE property, as an ORDERED LIST of operations that all commit under a single Confirm. This covers Access items, Connectivity, Interior/Exterior rooms and attributes, Policies & Instructions, existing Document metadata/deletes, and room/attribute photos. Put EVERY edit the user asked for into `operations` — one call, however many changes. \"Create a Gate room, add a gate-code attribute and a lockbox attribute to it, and attach this photo to the lockbox one\" is ONE call with three operations, never three calls and never two turns. Rooms are named, not id'd: an attribute operation carries `room` { title, scope }, and if that room does not exist yet it is CREATED first, inside this same confirmation, and the attribute is written into it — so you never need to create a room and ask the user to come back. Later operations land in rooms earlier operations create. Photos ride on the operation that owns their target via `photos`, so a plan with two attributes and two photos knows which photo goes where; never use preview_file_attachment for a room or attribute you are writing in this same request. Targets are matched by name and RE-RESOLVED at commit, so re-running a plan updates in place instead of duplicating. The returned plan lists every operation with its mode (create/update/noop/skipped), the rooms that will be created, and the photos that will attach; present it and get explicit confirmation, then call commit_property_knowledge_write with the token. Operations run in order — if one fails, the operations that depended on it are skipped and independent ones still run, so report which landed. If every operation is a noop, tell the user nothing would change and do not commit. For the SAME operations across MANY properties use preview_property_knowledge_batch. Vendor contacts have their own tool.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      property_id: {
        type: 'string',
        description: 'Property UUID. Resolve names with find_properties first.',
      },
      operations: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_OPERATIONS,
        description:
          'Ordered list of writes to apply to this property in one confirmation. Include every edit the user asked for.',
        items: {
          type: 'object',
          properties: {
            op: {
              type: 'string',
              enum: [
                'upsert_room',
                'delete_room',
                'upsert_attribute',
                'delete_attribute',
                'upsert_access_item',
                'delete_access_item',
                'upsert_connectivity',
                'upsert_policy',
                'delete_policy',
                'update_document',
                'delete_document',
              ],
              description:
                'Which write this operation performs. Upserts create when the target is absent and update when it is present — there are no separate add/edit operations.',
            },
            room: {
              type: 'object',
              description:
                'Required for room and attribute operations. Normally { title, scope } — the room is matched by that name and CREATED if missing (set create_if_missing false to fail instead). Use { room_id } only to address one exact existing row, e.g. when renaming it.',
              properties: {
                title: { type: 'string', description: 'Room title, matched case-insensitively, e.g. "Gate".' },
                scope: {
                  type: 'string',
                  enum: ['interior', 'exterior'],
                  description: 'Which side of Property Knowledge the room lives on.',
                },
                create_if_missing: {
                  type: 'boolean',
                  description: 'Default true — create the room when it is not there.',
                },
                room_id: { type: 'string', description: 'Address one exact room by id instead of by name.' },
              },
            },
            title: {
              type: 'string',
              description:
                'delete_attribute: the title of the attribute to remove from that room. delete_policy: the title of the policy to remove.',
            },
            document_id: {
              type: 'string',
              description: 'update_document / delete_document only: the document UUID.',
            },
            fields: {
              type: 'object',
              description:
                "Fields for this operation. Room: notes, sort_order, and title ONLY to rename an existing room (scope and the matching title come from `room`). Attribute: title (REQUIRED — the match key within its room), tags (array of appliance, amenity, safety, quirk, utility, access, other), body, sort_order; never pass room_id. Access item: type (one of entry_code, backup_code, team_code, owner_code, building_code, lobby_code, gate_code, elevator, parking_garage_code, mailbox_code, amenity_code, intercom_code, storage_code, lockbox_code, lockbox_location, key_location, fob_keycard, alarm_code, parking_spot, parking_type, parking_location, guest_parking_pass, ev_charger, other), label (defaults from type; required for 'other'), value (for a parking_type item it must be assigned/street/garage/other), notes. delete_access_item: type, and label when the type is 'other'. Connectivity: wifi_ssid, wifi_password, wifi_router_location. Policy: title (REQUIRED — the match key, a short label like \"Checkout\" or \"Quiet hours\"), body (the rule in full), sort_order. Document: title, notes, tag. Pass null to clear a nullable text field.",
            },
            photos: {
              type: 'object',
              description:
                'Room and attribute operations only. Uploaded images to attach to THIS operation\'s room or attribute once it exists. Use ids only from the uploaded-files context block.',
              properties: {
                inbound_file_ids: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'inbound_file_id UUIDs to attach.',
                },
                caption: { type: 'string', description: 'Optional caption applied to these photos.' },
              },
              required: ['inbound_file_ids'],
            },
          },
          required: ['op'],
        },
      },
    },
    required: ['property_id', 'operations'],
    additionalProperties: false,
  },
  handler,
};
