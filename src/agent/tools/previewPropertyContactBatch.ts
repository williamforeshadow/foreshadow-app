import { z } from 'zod';
import {
  previewPropertyContactBatch,
  type PropertyContactBatchPlan,
} from '@/src/server/properties/propertyContactBatch';
import { mintPropertyContactBatchToken } from '@/src/server/properties/propertyContactConfirmation';
import { maybeCreatePendingAction } from '@/src/server/agent/pendingActions';
import { requireOrgId, type ToolContext, type ToolDefinition, type ToolResult } from './types';

const CONTACT_TAGS = [
  'cleaning',
  'maintenance',
  'contractors',
  'owners',
  'stakeholders',
  'emergency',
  'other',
] as const;

const inputSchema = z
  .object({
    action: z.enum(['upsert', 'delete']),
    property_ids: z.array(z.string().uuid()).min(1).max(25),
    name: z.string().min(1).max(200),
    tags: z.array(z.enum(CONTACT_TAGS)).optional(),
    role: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    schedule: z.string().nullable().optional(),
    preferences: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    sort_order: z.number().int().optional(),
  })
  .strict();
type Input = z.infer<typeof inputSchema>;

export interface PreviewPropertyContactBatchData {
  plan: PropertyContactBatchPlan;
  confirmation_token: string;
  expires_at: string;
  pending_action_id?: string | null;
}

async function handler(
  input: Input,
  ctx: ToolContext,
): Promise<ToolResult<PreviewPropertyContactBatchData>> {
  const org = requireOrgId(ctx);
  if (typeof org !== 'string') return org;

  // The batch service is org-blind and every property_id is model-supplied, so
  // reject the whole batch if any id is outside the caller's org — dropping the
  // stray id silently would make the committed set differ from the shown plan.
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

  const result = await previewPropertyContactBatch({
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

  const minted = mintPropertyContactBatchToken(result.canonicalInput);
  // Skip the pending action when nothing would change — a Confirm button on a
  // pure no-op is noise.
  const hasWork = result.plan.steps.some((s) => s.mode !== 'noop');
  const pendingActionId = hasWork
    ? await maybeCreatePendingAction(ctx, {
        kind: 'property_contact_batch',
        canonicalInput: { input: result.canonicalInput },
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
    meta: { returned: result.plan.steps.length, limit: 25, truncated: false },
  };
}

export const previewPropertyContactBatchTool: ToolDefinition<
  Input,
  PreviewPropertyContactBatchData
> = {
  name: 'preview_property_contact_batch',
  description:
    "PREVIEW adding, updating, or removing the SAME vendor/property contact across MANY properties at once — one plan, one confirmation, one click. Use this instead of looping preview_property_contact_upsert whenever a contact covers more than one property, which is the normal case for cleaners, handymen, and owners (e.g. 'Maria cleans all four units', 'add this plumber to every La Mesa property', 'remove that vendor everywhere'). The contact is matched BY NAME per property, case-insensitively: found means update, not found means create, so re-running the same instruction never produces a duplicate. action:'delete' removes it, and a property that doesn't have that contact is reported as a no-op rather than a failure. The plan reports per-property mode (create/update/delete/noop) plus a `failures` array — present those honestly, including how many were already correct. Then call commit_property_contact_batch with the token. For a contact on ONE property, or when editing a specific contact you already resolved by id via get_property_knowledge, use preview_property_contact_upsert instead.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['upsert', 'delete'],
        description:
          "'upsert' creates the contact where it's missing and updates it where it exists. 'delete' removes it; properties without it are no-ops.",
      },
      property_ids: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 25,
        description:
          'Property UUIDs (1-25). Resolve names with find_properties first. Every id must belong to your organization or the whole batch is rejected.',
      },
      name: {
        type: 'string',
        minLength: 1,
        maxLength: 200,
        description:
          "The contact's display name. REQUIRED for both actions — it is the per-property match key, not just a field.",
      },
      tags: {
        type: 'array',
        items: { type: 'string', enum: [...CONTACT_TAGS] },
        description:
          'Multi-select tags applied to every property. Pass the FULL desired set; it replaces the existing tags on update.',
      },
      role: { type: ['string', 'null'], description: 'e.g. "Lead cleaner". null or empty clears.' },
      phone: { type: ['string', 'null'], description: 'Optional. null or empty clears.' },
      email: { type: ['string', 'null'], description: 'Optional. null or empty clears.' },
      schedule: {
        type: ['string', 'null'],
        description: 'Optional availability, e.g. "Every other Friday". null or empty clears.',
      },
      preferences: {
        type: ['string', 'null'],
        description: 'Optional, mainly for owner contacts. null or empty clears.',
      },
      notes: { type: ['string', 'null'], description: 'Optional. null or empty clears.' },
      sort_order: { type: 'integer', description: 'Display order.' },
    },
    required: ['action', 'property_ids', 'name'],
    additionalProperties: false,
  },
  handler,
};
