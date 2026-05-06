import { z } from 'zod';
import {
  deletePropertyNote,
  type DeletedNoteSnapshot,
} from '@/src/server/properties/deletePropertyNote';
import { consumeDeleteNoteToken } from '@/src/server/properties/propertyNoteConfirmation';
import type { ToolDefinition, ToolMeta, ToolResult } from './types';

const inputSchema = z.object({
  confirmation_token: z
    .string()
    .uuid()
    .describe(
      'Single-use token from preview_property_note_delete. Tokens expire 5 minutes after issuance.',
    ),
});

type Input = z.infer<typeof inputSchema>;

async function handler(input: Input): Promise<ToolResult<DeletedNoteSnapshot>> {
  const consumed = consumeDeleteNoteToken(input.confirmation_token);
  if (!consumed.ok) {
    return {
      ok: false,
      error: {
        code: 'confirmation_required',
        message:
          consumed.reason === 'expired'
            ? 'The confirmation token has expired. Tokens are valid for 5 minutes.'
            : 'No matching confirmation token. Tokens are issued only by preview_property_note_delete and are single-use.',
        hint:
          'Call preview_property_note_delete, present the plan, get explicit confirmation, then call this tool with the new token.',
      },
    };
  }

  const result = await deletePropertyNote(consumed.input);
  if (!result.ok) {
    return {
      ok: false,
      error: {
        code: result.error.code,
        message: result.error.message,
        hint: result.error.field
          ? `The "${result.error.field}" field is invalid. Re-run preview_property_note_delete.`
          : 'Re-run preview_property_note_delete.',
      },
    };
  }

  const meta: ToolMeta = { returned: 1, limit: 1, truncated: false };
  return { ok: true, data: result.snapshot, meta };
}

export const commitPropertyNoteDelete: ToolDefinition<Input, DeletedNoteSnapshot> = {
  name: 'commit_property_note_delete',
  description:
    'COMMIT a previewed-and-confirmed property note delete. Takes ONLY a confirmation_token from preview_property_note_delete. Returns a snapshot of the deleted note. Delete is HARD — the row is gone permanently after success. After success, confirm to the user using the snapshot.',
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      confirmation_token: {
        type: 'string',
        description: 'Single-use token from preview_property_note_delete. Required.',
      },
    },
    required: ['confirmation_token'],
    additionalProperties: false,
  },
  handler,
};
