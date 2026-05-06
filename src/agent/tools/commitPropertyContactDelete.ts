import { z } from 'zod';
import {
  deletePropertyContact,
  type DeletedContactSnapshot,
} from '@/src/server/properties/deletePropertyContact';
import { consumeDeleteContactToken } from '@/src/server/properties/propertyContactConfirmation';
import type { ToolDefinition, ToolMeta, ToolResult } from './types';

const inputSchema = z.object({
  confirmation_token: z
    .string()
    .uuid()
    .describe(
      'Single-use token from preview_property_contact_delete. Tokens expire 5 minutes after issuance.',
    ),
});

type Input = z.infer<typeof inputSchema>;

async function handler(input: Input): Promise<ToolResult<DeletedContactSnapshot>> {
  const consumed = consumeDeleteContactToken(input.confirmation_token);
  if (!consumed.ok) {
    return {
      ok: false,
      error: {
        code: 'confirmation_required',
        message:
          consumed.reason === 'expired'
            ? 'The confirmation token has expired. Tokens are valid for 5 minutes.'
            : 'No matching confirmation token. Tokens are issued only by preview_property_contact_delete and are single-use.',
        hint:
          'Call preview_property_contact_delete, present the plan, get explicit confirmation, then call this tool with the new token.',
      },
    };
  }

  const result = await deletePropertyContact(consumed.input);
  if (!result.ok) {
    return {
      ok: false,
      error: {
        code: result.error.code,
        message: result.error.message,
        hint: result.error.field
          ? `The "${result.error.field}" field is invalid. Re-run preview_property_contact_delete.`
          : 'Re-run preview_property_contact_delete.',
      },
    };
  }

  const meta: ToolMeta = { returned: 1, limit: 1, truncated: false };
  return { ok: true, data: result.snapshot, meta };
}

export const commitPropertyContactDelete: ToolDefinition<Input, DeletedContactSnapshot> = {
  name: 'commit_property_contact_delete',
  description:
    'COMMIT a previewed-and-confirmed property contact delete. Takes ONLY a confirmation_token from preview_property_contact_delete. Returns a snapshot of the deleted contact. Delete is HARD — the row is gone permanently after success. After success, confirm to the user using the snapshot.',
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      confirmation_token: {
        type: 'string',
        description: 'Single-use token from preview_property_contact_delete. Required.',
      },
    },
    required: ['confirmation_token'],
    additionalProperties: false,
  },
  handler,
};
