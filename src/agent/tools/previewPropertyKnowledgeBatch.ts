import { z } from 'zod';
import {
  previewPropertyKnowledgeBatch,
  type PropertyKnowledgeBatchPlan,
} from '@/src/server/properties/propertyKnowledgeWriteBatch';
import {
  propertyKnowledgeOperationSchema,
  MAX_OPERATIONS,
} from '@/src/server/properties/propertyKnowledgeOperations';
import { mintPropertyKnowledgeBatchToken } from '@/src/server/properties/propertyKnowledgeWriteConfirmation';
import { maybeCreatePendingAction } from '@/src/server/agent/pendingActions';
import { requireOrgId, type ToolContext, type ToolDefinition, type ToolResult } from './types';

const inputSchema = z
  .object({
    property_ids: z.array(z.string().uuid()).min(1).max(25),
    operations: z.array(propertyKnowledgeOperationSchema).min(1).max(MAX_OPERATIONS),
  })
  .passthrough();
type Input = z.infer<typeof inputSchema>;

export interface PreviewPropertyKnowledgeBatchData {
  plan: PropertyKnowledgeBatchPlan;
  confirmation_token: string;
  expires_at: string;
  pending_action_id?: string | null;
}

async function handler(
  input: Input,
  ctx: ToolContext,
): Promise<ToolResult<PreviewPropertyKnowledgeBatchData>> {
  const org = requireOrgId(ctx);
  if (typeof org !== 'string') return org;

  // Org guard across the whole list: the batch service is org-blind and every
  // property_id is model-supplied, so any id outside the caller's org has to be
  // rejected BEFORE we read or plan anything. Rejecting the whole batch (rather
  // than silently dropping the stray id) keeps the confirmed plan equal to what
  // the operator was shown.
  const { data: rows, error } = await ctx.db
    .from('properties')
    .select('id')
    .in('id', input.property_ids)
    .eq('org_id', org);
  if (error) {
    return { ok: false, error: { code: 'db_error', message: error.message } };
  }
  const visible = new Set(((rows ?? []) as Array<{ id: string }>).map((r) => r.id));
  const missing = input.property_ids.filter((id) => !visible.has(id));
  if (missing.length > 0) {
    return {
      ok: false,
      error: {
        code: 'not_found',
        message: `No property found with id ${missing.join(', ')}.`,
        hint: 'Call find_properties to resolve property names into valid ids.',
      },
    };
  }

  const result = await previewPropertyKnowledgeBatch({
    property_ids: input.property_ids,
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

  const minted = mintPropertyKnowledgeBatchToken(result.canonicalInput);
  const pendingActionId = await maybeCreatePendingAction(ctx, {
    kind: 'property_knowledge_batch',
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
      returned: result.plan.properties.length,
      limit: 25,
      truncated: result.plan.truncated,
    },
  };
}

export const previewPropertyKnowledgeBatchTool: ToolDefinition<
  Input,
  PreviewPropertyKnowledgeBatchData
> = {
  name: 'preview_property_knowledge_batch',
  description:
    "PREVIEW the SAME ordered list of Property Knowledge operations applied to MANY properties (2-25) at once — one plan, one confirmation, one click. Reach for this instead of looping the single tool whenever the user says 'all', 'every', 'each', or names more than one property. It takes the SAME `operations` array as preview_property_knowledge_write, so everything that tool can do in one pass this one can do across a list: create a room and put two attributes in it, add several attributes to an existing room, attach photos, set access items and connectivity — all in one confirmation. Targets are matched BY NAME per property (access item by type, room by title+scope, attribute by title within its room), so you do NOT need get_property_knowledge per property first; resolve the property_ids with find_properties and go. Rooms named by an attribute operation are CREATED per property when missing, inside this same confirmation. Because ids are per-property, room { room_id } and the two document operations are rejected here — use preview_property_knowledge_write for those. If the operations carry photos, the SAME uploaded file is copied onto every property (a photo is usually of one physical place, so say that plainly when you present the plan); the plan reports it as photos_fanout. The plan returns shared_operations (the list, described once), a per-property breakdown with each operation's mode (create/update/noop/skipped), rooms_to_create, totals, a failures array for properties that could not be planned, and `uniform` — when uniform is true, describe the operations once for the whole set rather than repeating them per property. Then call commit_property_knowledge_batch with the token. For a single property, use preview_property_knowledge_write.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      property_ids: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 25,
        description:
          'Property UUIDs to write to (1-25). Resolve names with find_properties first. Every id must belong to your organization or the whole batch is rejected.',
      },
      operations: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_OPERATIONS,
        description:
          "Ordered list of writes applied to EVERY property in the list. Same shape as preview_property_knowledge_write's operations, minus update_document/delete_document and minus room { room_id } — both address one row on one property. Total operations x properties must not exceed 100, and photo copies (files x properties) must not exceed 20.",
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
              ],
              description:
                'Which write to apply on every property. Upserts create when the target is absent on that property and update when present. Deletes match by the same name fields as the matching upsert, and a property that lacks the target is a noop rather than a failure — it is already in the state the user asked for.',
            },
            room: {
              type: 'object',
              description:
                'Required for room and attribute operations. Must be { title, scope } — resolved per property, and created there if missing. Set create_if_missing false to fail on properties that lack it instead. room_id is rejected in a batch.',
              properties: {
                title: { type: 'string', description: 'Room title, matched case-insensitively per property.' },
                scope: { type: 'string', enum: ['interior', 'exterior'] },
                create_if_missing: { type: 'boolean' },
              },
              required: ['title', 'scope'],
            },
            title: {
              type: 'string',
              description: 'delete_attribute only: title of the attribute to remove from that room.',
            },
            fields: {
              type: 'object',
              description:
                "Fields applied to every property. Attribute: title (REQUIRED — the per-property match key), tags, body. Room: notes, sort_order. Access item: type, label, value, notes. Connectivity: wifi_ssid, wifi_password, wifi_router_location. Never pass room_id.",
            },
            photos: {
              type: 'object',
              description:
                'Room and attribute operations only. The same uploaded image is copied onto every property. Use sparingly — a photo usually belongs to one property.',
              properties: {
                inbound_file_ids: { type: 'array', items: { type: 'string' } },
                caption: { type: 'string' },
              },
              required: ['inbound_file_ids'],
            },
          },
          required: ['op'],
        },
      },
    },
    required: ['property_ids', 'operations'],
    additionalProperties: false,
  },
  handler,
};
