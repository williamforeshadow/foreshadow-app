import { z } from 'zod';
import {
  previewUpsertPropertyContact,
  type UpsertContactPlan,
} from '@/src/server/properties/upsertPropertyContact';
import { mintUpsertContactToken } from '@/src/server/properties/propertyContactConfirmation';
import { maybeCreatePendingAction } from '@/src/server/agent/pendingActions';
import type { ToolContext, ToolDefinition, ToolResult } from './types';

const inputSchema = z
  .object({
    property_id: z.string().uuid().describe('Property UUID. Resolve via find_properties.'),
    contact_id: z
      .string()
      .uuid()
      .optional()
      .describe(
        "OMIT to create a new contact. PASS the existing contact's UUID to update.",
      ),
    tags: z
      .array(z.enum(['cleaning', 'maintenance', 'contractors', 'owners', 'stakeholders', 'emergency', 'other']))
      .optional()
      .describe(
        "Multi-select tags. Any of: cleaning, maintenance, contractors, owners, stakeholders, emergency, other. Pass the full desired set (replaces existing).",
      ),
    name: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('Display name. Required on create; optional on update (must be non-empty if passed).'),
    role: z
      .string()
      .nullable()
      .optional()
      .describe('Optional role/relationship (e.g. "Lead cleaner"). null/empty clears.'),
    phone: z
      .string()
      .nullable()
      .optional()
      .describe('Optional phone. null/empty clears.'),
    email: z
      .string()
      .nullable()
      .optional()
      .describe('Optional email. null/empty clears.'),
    schedule: z
      .string()
      .nullable()
      .optional()
      .describe('Optional schedule/availability (e.g. "Every other Friday"). null/empty clears.'),
    preferences: z
      .string()
      .nullable()
      .optional()
      .describe('Optional preferences, mainly for owners (e.g. approval thresholds). null/empty clears.'),
    notes: z
      .string()
      .nullable()
      .optional()
      .describe('Optional free-text notes. null/empty clears.'),
    sort_order: z
      .number()
      .int()
      .optional()
      .describe('Display order.'),
  })
  .strict();

type Input = z.infer<typeof inputSchema>;

export interface PreviewUpsertContactData {
  plan: UpsertContactPlan;
  confirmation_token: string;
  expires_at: string;
  pending_action_id?: string | null;
}

async function handler(
  input: Input,
  ctx: ToolContext,
): Promise<ToolResult<PreviewUpsertContactData>> {
  const enriched = {
    ...input,
    actor_user_id: ctx.actor?.appUserId ?? null,
    source:
      ctx.surface === 'slack' ? ('agent_slack' as const) : ('agent_web' as const),
  };
  const result = await previewUpsertPropertyContact(enriched);
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
  const minted = mintUpsertContactToken(result.canonicalInput);
  const hasChanges =
    result.plan.mode === 'create' || (result.plan.changes?.length ?? 0) > 0;
  const pendingActionId = hasChanges
    ? await maybeCreatePendingAction(ctx, {
        kind: 'property_contact_upsert',
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
    meta: { returned: 1, limit: 1, truncated: false },
  };
}

export const previewPropertyContactUpsert: ToolDefinition<Input, PreviewUpsertContactData> = {
  name: 'preview_property_contact_upsert',
  description:
    "PREVIEW creating or updating a property/vendor contact. Single tool covers both: omit contact_id to create, pass contact_id to update. Contacts carry multi-select tags (cleaning, maintenance, contractors, owners, stakeholders, emergency, other), an optional schedule, and — mainly for owner contacts — a preferences field. Returns a plan with mode='create' or mode='update' and a confirmation_token. On update, returns a precise field-by-field changes diff — present those before/after values to the user. If the diff is EMPTY on update, skip the commit. Required workflow: preview → present plan → user confirms → commit_property_contact_upsert with token. Tokens are single-use, 5-minute TTL.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      property_id: { type: 'string', description: 'Property UUID. Resolve via find_properties.' },
      contact_id: {
        type: 'string',
        description: "Omit to create. Pass an existing contact's UUID to update.",
      },
      tags: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['cleaning', 'maintenance', 'contractors', 'owners', 'stakeholders', 'emergency', 'other'],
        },
        description: 'Multi-select tags. Pass the full desired set (replaces existing).',
      },
      name: {
        type: 'string',
        minLength: 1,
        maxLength: 200,
        description: 'Required on create.',
      },
      role: {
        type: ['string', 'null'],
        description: 'Optional. null or empty clears.',
      },
      phone: { type: ['string', 'null'], description: 'Optional. null or empty clears.' },
      email: { type: ['string', 'null'], description: 'Optional. null or empty clears.' },
      schedule: { type: ['string', 'null'], description: 'Optional schedule/availability. null or empty clears.' },
      preferences: { type: ['string', 'null'], description: 'Optional preferences (mainly owners). null or empty clears.' },
      notes: { type: ['string', 'null'], description: 'Optional. null or empty clears.' },
      sort_order: { type: 'integer', description: 'Display order.' },
    },
    required: ['property_id'],
    additionalProperties: false,
  },
  handler,
};
