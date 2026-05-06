import { z } from 'zod';
import {
  upsertPropertyContact,
  type PropertyContactRow,
} from '@/src/server/properties/upsertPropertyContact';
import { consumeUpsertContactToken } from '@/src/server/properties/propertyContactConfirmation';
import type { ToolDefinition, ToolMeta, ToolResult } from './types';

const inputSchema = z.object({
  confirmation_token: z
    .string()
    .uuid()
    .describe(
      'Single-use token from preview_property_contact_upsert. Tokens expire 5 minutes after issuance.',
    ),
});

type Input = z.infer<typeof inputSchema>;

export interface CommitUpsertContactResultData {
  contact: PropertyContactRow;
  mode: 'create' | 'update';
  changes?: Array<{ field: string; before: unknown; after: unknown }>;
}

async function handler(input: Input): Promise<ToolResult<CommitUpsertContactResultData>> {
  const consumed = consumeUpsertContactToken(input.confirmation_token);
  if (!consumed.ok) {
    return {
      ok: false,
      error: {
        code: 'confirmation_required',
        message:
          consumed.reason === 'expired'
            ? 'The confirmation token has expired. Tokens are valid for 5 minutes.'
            : 'No matching confirmation token. Tokens are issued only by preview_property_contact_upsert and are single-use.',
        hint:
          'Call preview_property_contact_upsert, present the plan, get explicit confirmation, then call this tool with the new token.',
      },
    };
  }

  const result = await upsertPropertyContact(consumed.input);
  if (!result.ok) {
    return {
      ok: false,
      error: {
        code: result.error.code,
        message: result.error.message,
        hint: result.error.field
          ? `The "${result.error.field}" field is invalid. Re-run preview_property_contact_upsert.`
          : 'Re-run preview_property_contact_upsert.',
      },
    };
  }

  const meta: ToolMeta = { returned: 1, limit: 1, truncated: false };
  const data: CommitUpsertContactResultData = {
    contact: result.contact,
    mode: result.mode,
  };
  if (result.changes !== undefined) data.changes = result.changes;
  return { ok: true, data, meta };
}

export const commitPropertyContactUpsert: ToolDefinition<Input, CommitUpsertContactResultData> = {
  name: 'commit_property_contact_upsert',
  description:
    "COMMIT a previewed-and-confirmed property contact write (create or update). Takes ONLY a confirmation_token from preview_property_contact_upsert. Returns the resulting contact row plus mode='create'|'update' and (on update) the changes diff. Required workflow: preview → present → user confirms → commit. After success, confirm to the user using the row + changes you got back.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      confirmation_token: {
        type: 'string',
        description: 'Single-use token from preview_property_contact_upsert. Required.',
      },
    },
    required: ['confirmation_token'],
    additionalProperties: false,
  },
  handler,
};
