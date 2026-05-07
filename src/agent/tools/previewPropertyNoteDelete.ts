import { z } from 'zod';
import {
  previewDeletePropertyNote,
  type DeleteNotePlan,
} from '@/src/server/properties/deletePropertyNote';
import { mintDeleteNoteToken } from '@/src/server/properties/propertyNoteConfirmation';
import { createPendingAction } from '@/src/server/agent/pendingActions';
import type { ToolContext, ToolDefinition, ToolResult } from './types';

const inputSchema = z.object({
  property_id: z.string().uuid().describe('Property UUID.'),
  note_id: z.string().uuid().describe('Note UUID to delete.'),
});

type Input = z.infer<typeof inputSchema>;

export interface PreviewDeleteNoteData {
  plan: DeleteNotePlan;
  confirmation_token: string;
  expires_at: string;
  pending_action_id?: string | null;
}

async function handler(
  input: Input,
  ctx: ToolContext,
): Promise<ToolResult<PreviewDeleteNoteData>> {
  const enriched = {
    ...input,
    actor_user_id: ctx.actor?.appUserId ?? null,
    source:
      ctx.surface === 'slack' ? ('agent_slack' as const) : ('agent_web' as const),
  };
  const result = await previewDeletePropertyNote(enriched);
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
  const minted = mintDeleteNoteToken(result.canonicalInput);
  const pendingActionId =
    ctx.surface === 'slack' && ctx.slack
      ? await createPendingAction({
          kind: 'property_note_delete',
          requesterAppUserId: ctx.actor?.appUserId ?? null,
          slack: ctx.slack,
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

export const previewPropertyNoteDelete: ToolDefinition<Input, PreviewDeleteNoteData> = {
  name: 'preview_property_note_delete',
  description:
    "PREVIEW deleting a property-level note. Returns a plan showing the note's scope, title, and a body preview so the user can confirm they're deleting the right one. Returns a confirmation_token for commit_property_note_delete. Delete is HARD — the row is removed permanently. Required workflow: preview → present → user confirms → commit.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      property_id: { type: 'string', description: 'Property UUID.' },
      note_id: { type: 'string', description: 'Note UUID to delete.' },
    },
    required: ['property_id', 'note_id'],
    additionalProperties: false,
  },
  handler,
};
