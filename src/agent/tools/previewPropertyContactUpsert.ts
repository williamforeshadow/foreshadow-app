import { z } from 'zod';
import {
  previewUpsertPropertyContact,
  type UpsertContactPlan,
} from '@/src/server/properties/upsertPropertyContact';
import { mintUpsertContactToken } from '@/src/server/properties/propertyContactConfirmation';
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
    category: z
      .enum(['cleaning', 'maintenance', 'stakeholder', 'emergency'])
      .optional()
      .describe(
        "Required when creating. Optional on update (category IS editable). 'cleaning' = housekeeping. 'maintenance' = repairs/handymen. 'stakeholder' = owner/co-host/PM. 'emergency' = police/fire/locksmith etc.",
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
    notes: z
      .string()
      .nullable()
      .optional()
      .describe('Optional free-text notes. null/empty clears.'),
    sort_order: z
      .number()
      .int()
      .optional()
      .describe('Display order within the category.'),
  })
  .strict();

type Input = z.infer<typeof inputSchema>;

export interface PreviewUpsertContactData {
  plan: UpsertContactPlan;
  confirmation_token: string;
  expires_at: string;
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

export const previewPropertyContactUpsert: ToolDefinition<Input, PreviewUpsertContactData> = {
  name: 'preview_property_contact_upsert',
  description:
    "PREVIEW creating or updating a property contact (cleaning / maintenance / stakeholder / emergency). Single tool covers both: omit contact_id to create, pass contact_id to update. Returns a plan with mode='create' or mode='update' and a confirmation_token. On update, returns a precise field-by-field changes diff — present those before/after values to the user. If the diff is EMPTY on update, tell the user nothing would change and skip the commit. Unlike notes, category IS editable on update — moving a contact across categories is allowed in one call. Required workflow: preview → present plan → user confirms → commit_property_contact_upsert with token. Tokens are single-use, 5-minute TTL.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      property_id: { type: 'string', description: 'Property UUID. Resolve via find_properties.' },
      contact_id: {
        type: 'string',
        description: "Omit to create. Pass an existing contact's UUID to update.",
      },
      category: {
        type: 'string',
        enum: ['cleaning', 'maintenance', 'stakeholder', 'emergency'],
        description: 'Required on create; optional and editable on update.',
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
      notes: { type: ['string', 'null'], description: 'Optional. null or empty clears.' },
      sort_order: { type: 'integer', description: 'Display order in the category.' },
    },
    required: ['property_id'],
    additionalProperties: false,
  },
  handler,
};
