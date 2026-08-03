import { z } from 'zod';
import {
  previewPropertyKnowledgeBatch,
  type PropertyKnowledgeBatchPlan,
} from '@/src/server/properties/propertyKnowledgeWriteBatch';
import { mintPropertyKnowledgeBatchToken } from '@/src/server/properties/propertyKnowledgeWriteConfirmation';
import { maybeCreatePendingAction } from '@/src/server/agent/pendingActions';
import { requireOrgId, type ToolContext, type ToolDefinition, type ToolResult } from './types';

const inputSchema = z
  .object({
    action: z.enum([
      'upsert_access_item',
      'upsert_connectivity',
      'upsert_room',
      'upsert_attribute',
      'delete_access_item',
      'delete_room',
      'delete_attribute',
    ]),
    property_ids: z.array(z.string().uuid()).min(1).max(25),
    fields: z.record(z.string(), z.unknown()),
    room: z
      .object({
        title: z.string().min(1).max(120),
        scope: z.enum(['interior', 'exterior']),
        create_if_missing: z.boolean().optional(),
      })
      .optional(),
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

  // Org guard, same shape as the single-write tool but across the whole list:
  // the batch service is org-blind and every property_id is model-supplied, so
  // any id outside the caller's org has to be rejected BEFORE we read or plan
  // anything. Rejecting the whole batch (rather than silently dropping the
  // stray id) keeps the confirmed plan equal to what the operator was shown.
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
    ...input,
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
      returned: result.plan.steps.length,
      limit: 25,
      truncated: false,
    },
  };
}

export const previewPropertyKnowledgeBatchTool: ToolDefinition<
  Input,
  PreviewPropertyKnowledgeBatchData
> = {
  name: 'preview_property_knowledge_batch',
  description:
    "PREVIEW the SAME Property Knowledge write applied to MANY properties at once — one plan, one confirmation, one click. Use this instead of looping preview_property_knowledge_write whenever the user says 'all', 'every', 'each', or names more than one property (e.g. 'the gate code is 3252 at all the Long Branch properties', 'update the wifi password at these four', 'remove the old gate code everywhere'). Supported actions: upsert_access_item, upsert_connectivity, upsert_room, upsert_attribute, delete_access_item, delete_room, delete_attribute. Deletes locate their target by the same name fields the matching upsert uses, and a property that does not have the target is reported as a no-op rather than a failure — it is already in the state the user asked for. Deleting a room also removes its attributes and photos, so present that before the user confirms. Targets are matched BY NAME per property, not by id, so the same fields work across the whole list and re-running updates in place instead of duplicating. For upsert_attribute you MUST pass `room` { title, scope } instead of fields.room_id: the room is resolved per property and, when missing, CREATED as part of this same confirmation before the attribute is written into it — so 'add a gate code attribute under an exterior Gate room at all three' is ONE preview and ONE Confirm, never two rounds. The returned plan lists every property with its mode (create/update/noop), any room that will be created first, and a `failures` array for properties that could not be planned; present those honestly. Then call commit_property_knowledge_batch with the token. For a write to ONE property, or for document metadata edits and deletes (which address a single uploaded file by id), use preview_property_knowledge_write instead.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: [
          'upsert_access_item',
          'upsert_connectivity',
          'upsert_room',
          'upsert_attribute',
          'delete_access_item',
          'delete_room',
          'delete_attribute',
        ],
        description:
          'Which write to apply to every property in the list. Deletes match their target by the same name fields as the matching upsert. Document edits are not batchable (a document is one uploaded file addressed by id) — use preview_property_knowledge_write.',
      },
      property_ids: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 25,
        description:
          'Property UUIDs to write to (1-25). Resolve names with find_properties first. Every id must belong to your organization or the whole batch is rejected.',
      },
      fields: {
        type: 'object',
        description:
          "Fields applied to every property. Access item: type (entry_code, gate_code, lockbox_code, parking_spot, other, ...), label, value, notes. Connectivity: wifi_ssid, wifi_password, wifi_router_location. Room: scope ('interior'|'exterior') and title, both required. Attribute: title (REQUIRED — it is the per-property match key), tags (array of appliance, amenity, safety, quirk, utility, access, other), body. Never pass room_id here; use the `room` object.",
      },
      room: {
        type: 'object',
        description:
          'Attribute batches only (upsert AND delete), and REQUIRED for them. Names the containing room per property. On upsert, if no room with this title and scope exists on a property it is created first, in the same confirmation, and the attribute is written into it — set create_if_missing to false to fail on those properties instead. On delete, a missing room is simply a no-op; deleting never creates.',
        properties: {
          title: {
            type: 'string',
            description: 'Room title to match case-insensitively, e.g. "Gate".',
          },
          scope: {
            type: 'string',
            enum: ['interior', 'exterior'],
            description: 'Which side of Property Knowledge the room lives on.',
          },
          create_if_missing: {
            type: 'boolean',
            description:
              'Default true — create the room when a property lacks it. Set false to require the room already exist.',
          },
        },
        required: ['title', 'scope'],
      },
    },
    required: ['action', 'property_ids', 'fields'],
    additionalProperties: false,
  },
  handler,
};
