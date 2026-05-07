import { z } from 'zod';
import {
  previewCreateBin,
  type CreateBinPlan,
} from '@/src/server/bins/createBin';
import { mintCreateBinToken } from '@/src/server/bins/createBinConfirmation';
import { createPendingAction } from '@/src/server/agent/pendingActions';
import type { ToolContext, ToolDefinition, ToolResult } from './types';

// preview_bin — first half of the two-step write protocol for sub-bins.
//
// Mirrors preview_task in shape and semantics: validates fields,
// resolves the optional created_by user to a display name, surfaces
// duplicate-name conflicts, and returns a plan + a single-use
// confirmation_token. The agent presents the plan, asks for explicit
// confirmation, and only then calls create_bin with the token.
//
// preview_bin does NOT write. Calling it repeatedly while negotiating
// names with the user is fine — each call mints a fresh token and
// orphans the previous one (which expires in 5 minutes regardless).

const inputSchema = z.object({
  name: z
    .string()
    .min(1, 'name is required')
    .max(80, 'name must be 80 characters or fewer')
    .describe(
      'Display name for the new sub-bin. Required. Keep concise — this is what the user sees on the bins page tile and in dropdowns. Duplicate-name conflicts (case-insensitive) are caught here before token issuance.',
    ),
  description: z
    .string()
    .max(500, 'description must be 500 characters or fewer')
    .optional()
    .describe(
      "Optional one-line description of what the sub-bin is for (e.g. 'social media content and ad strategy'). Renders under the bin name on the bins page. Omit when there's nothing to add beyond the name.",
    ),
  created_by: z
    .string()
    .uuid()
    .optional()
    .describe(
      "User UUID to attribute the bin to. Pass the talking-to user's user_id when known (the system prompt provides it via the actor block). Omit when unknown — the row will be created with no created_by.",
    ),
});

type Input = z.infer<typeof inputSchema>;

export interface PreviewBinResultData {
  plan: CreateBinPlan;
  confirmation_token: string;
  expires_at: string;
  pending_action_id?: string | null;
}

async function handler(
  input: Input,
  ctx: ToolContext,
): Promise<ToolResult<PreviewBinResultData>> {
  const result = await previewCreateBin(input);

  if (!result.ok) {
    if (result.error.code === 'invalid_input') {
      return {
        ok: false,
        error: {
          code: 'invalid_input',
          message: result.error.message,
          hint: result.error.field
            ? `Check the "${result.error.field}" field and call again.`
            : undefined,
        },
      };
    }
    if (result.error.code === 'duplicate_name') {
      return {
        ok: false,
        error: {
          code: 'duplicate_name',
          message: result.error.message,
          hint: 'Either pick a different name OR call find_bins with the existing name to get its bin_id and use that sub-bin instead of creating a new one.',
        },
      };
    }
    if (result.error.code === 'not_found') {
      return {
        ok: false,
        error: {
          code: 'not_found',
          message: result.error.message,
          hint: 'The created_by user_id doesn\'t exist. Use the actor user_id from the system prompt, or omit created_by.',
        },
      };
    }
    return {
      ok: false,
      error: { code: 'db_error', message: result.error.message },
    };
  }

  const minted = mintCreateBinToken(result.canonicalInput);
  const pendingActionId =
    ctx.surface === 'slack' && ctx.slack
      ? await createPendingAction({
          kind: 'create_bin',
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

export const previewBin: ToolDefinition<Input, PreviewBinResultData> = {
  name: 'preview_bin',
  description:
    "PREVIEW a new sub-bin before creating it. ALWAYS call this first when the user asks to create a bin / sub-bin. Validates the name, surfaces duplicate-name conflicts, resolves the created_by user (if any) to a display name, and returns a plan + a confirmation_token. After calling: present the plan in plain English, ask for explicit confirmation ('shall I create this sub-bin?'), and only then call create_bin with the returned token. Tokens are single-use and expire in 5 minutes. If the user wants to change the name or description, call preview_bin again with the updated fields. preview_bin never writes; safe to call repeatedly. Note: this only creates SUB-BINS — there is no preview_bin path to create a Task Bin (the Task Bin is fixture data and already exists).",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      name: {
        type: 'string',
        minLength: 1,
        maxLength: 80,
        description:
          'Display name for the new sub-bin. Required. Keep concise — appears on tiles and dropdowns. Duplicates rejected case-insensitively.',
      },
      description: {
        type: 'string',
        maxLength: 500,
        description:
          'Optional one-line description shown beneath the bin name on the bins page.',
      },
      created_by: {
        type: 'string',
        description:
          "User UUID to attribute the bin to. Use the actor user_id when known; omit otherwise.",
      },
    },
    required: ['name'],
    additionalProperties: false,
  },
  handler,
};
