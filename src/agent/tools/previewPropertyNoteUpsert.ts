import { z } from 'zod';
import {
  previewUpsertPropertyNote,
  type UpsertNotePlan,
} from '@/src/server/properties/upsertPropertyNote';
import { mintUpsertNoteToken } from '@/src/server/properties/propertyNoteConfirmation';
import { createPendingAction } from '@/src/server/agent/pendingActions';
import type { ToolContext, ToolDefinition, ToolResult } from './types';

// preview_property_note_upsert — first half of the two-step write
// protocol for property notes. ONE tool covers both create and update:
//   - omit note_id  → create a new note (scope + body required)
//   - pass note_id  → update an existing note (only the fields you pass change)
//
// Why merge add + update into one tool: the two surfaces validate
// nearly the same fields, share the same body/title rules, and the LLM
// has historically struggled to pick between near-identical write tools.
// One upsert with a clear note_id semantic is easier to choose for and
// easier to teach.

const inputSchema = z
  .object({
    property_id: z.string().uuid().describe('Property UUID. Resolve via find_properties.'),
    note_id: z
      .string()
      .uuid()
      .optional()
      .describe(
        "OMIT to create a new note. PASS the existing note's UUID to update it. Required to update; forbidden to create.",
      ),
    scope: z
      .enum(['owner_preferences', 'known_issues'])
      .optional()
      .describe(
        "Required when creating. Forbidden when updating (scope is locked on existing notes — delete + recreate to move). 'owner_preferences' = how the owner wants things handled. 'known_issues' = broken/quirky/under-repair items.",
      ),
    title: z
      .string()
      .nullable()
      .optional()
      .describe(
        'Optional short label. Pass null or empty string to clear. Omit entirely to leave unchanged on update.',
      ),
    body: z
      .string()
      .min(1, 'body cannot be empty')
      .max(8000)
      .optional()
      .describe(
        'The note text. REQUIRED on create. Optional on update (omit to leave unchanged). Plain text — no markdown.',
      ),
    sort_order: z
      .number()
      .int()
      .optional()
      .describe('Display order among notes in the same scope.'),
  })
  .strict();

type Input = z.infer<typeof inputSchema>;

export interface PreviewUpsertNoteData {
  plan: UpsertNotePlan;
  confirmation_token: string;
  expires_at: string;
  pending_action_id?: string | null;
}

async function handler(
  input: Input,
  ctx: ToolContext,
): Promise<ToolResult<PreviewUpsertNoteData>> {
  // Bind the actor and source server-side. The model has no input
  // surface for either — they're computed from the run context so the
  // ledger entry is always attributed correctly.
  const enriched = {
    ...input,
    actor_user_id: ctx.actor?.appUserId ?? null,
    source:
      ctx.surface === 'slack' ? ('agent_slack' as const) : ('agent_web' as const),
  };
  const result = await previewUpsertPropertyNote(enriched);
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
  const minted = mintUpsertNoteToken(result.canonicalInput);
  const hasChanges =
    result.plan.mode === 'create' || (result.plan.changes?.length ?? 0) > 0;
  const pendingActionId =
    ctx.surface === 'slack' && ctx.slack && hasChanges
      ? await createPendingAction({
          kind: 'property_note_upsert',
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

export const previewPropertyNoteUpsert: ToolDefinition<Input, PreviewUpsertNoteData> = {
  name: 'preview_property_note_upsert',
  description:
    "PREVIEW creating or updating a property-level note (Owner Preferences / Known Issues). Single tool covers both: omit note_id to create, pass note_id to update. Returns a plan with mode='create' or mode='update' and a confirmation_token. On update, also returns a precise field-by-field changes diff — present those before/after values to the user. If the diff is EMPTY on update, tell the user nothing would change and skip the commit. scope is REQUIRED on create and FORBIDDEN on update (notes can't be moved across scopes — delete + recreate to migrate). After preview: present the plan, get explicit user confirmation, then call commit_property_note_upsert with the token. Tokens are single-use, 5-minute TTL.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      property_id: {
        type: 'string',
        description:
          'Property UUID. Resolve via find_properties first when given a name.',
      },
      note_id: {
        type: 'string',
        description:
          "Omit to create. Pass an existing note's UUID to update it.",
      },
      scope: {
        type: 'string',
        enum: ['owner_preferences', 'known_issues'],
        description:
          "Required on create, forbidden on update. owner_preferences = how the owner wants things handled. known_issues = broken/quirky items with status.",
      },
      title: {
        type: ['string', 'null'],
        description:
          'Optional label. null or empty string clears it. Omit to leave unchanged on update.',
      },
      body: {
        type: 'string',
        minLength: 1,
        maxLength: 8000,
        description:
          'Note text. Required on create; optional on update. Plain text only.',
      },
      sort_order: {
        type: 'integer',
        description: 'Display order among notes in the same scope.',
      },
    },
    required: ['property_id'],
    additionalProperties: false,
  },
  handler,
};
