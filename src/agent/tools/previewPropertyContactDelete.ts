import { z } from 'zod';
import {
  previewDeletePropertyContact,
  type DeleteContactPlan,
} from '@/src/server/properties/deletePropertyContact';
import { mintDeleteContactToken } from '@/src/server/properties/propertyContactConfirmation';
import type { ToolContext, ToolDefinition, ToolResult } from './types';

const inputSchema = z.object({
  property_id: z.string().uuid().describe('Property UUID.'),
  contact_id: z.string().uuid().describe('Contact UUID to delete.'),
});

type Input = z.infer<typeof inputSchema>;

export interface PreviewDeleteContactData {
  plan: DeleteContactPlan;
  confirmation_token: string;
  expires_at: string;
}

async function handler(
  input: Input,
  ctx: ToolContext,
): Promise<ToolResult<PreviewDeleteContactData>> {
  const enriched = {
    ...input,
    actor_user_id: ctx.actor?.appUserId ?? null,
    source:
      ctx.surface === 'slack' ? ('agent_slack' as const) : ('agent_web' as const),
  };
  const result = await previewDeletePropertyContact(enriched);
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
  const minted = mintDeleteContactToken(result.canonicalInput);
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

export const previewPropertyContactDelete: ToolDefinition<Input, PreviewDeleteContactData> = {
  name: 'preview_property_contact_delete',
  description:
    "PREVIEW deleting a property contact. Returns a plan showing the contact's category, name, role, and contact info so the user can confirm. Returns a confirmation_token for commit_property_contact_delete. Delete is HARD — the row is removed permanently. Required workflow: preview → present → user confirms → commit.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      property_id: { type: 'string', description: 'Property UUID.' },
      contact_id: { type: 'string', description: 'Contact UUID to delete.' },
    },
    required: ['property_id', 'contact_id'],
    additionalProperties: false,
  },
  handler,
};
