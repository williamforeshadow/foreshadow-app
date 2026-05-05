import { z } from 'zod';
import { createBin as createBinService } from '@/src/server/bins/createBin';
import { consumeCreateBinToken } from '@/src/server/bins/createBinConfirmation';
import { binsIndexUrl } from '@/src/lib/links';
import type { ToolDefinition, ToolMeta, ToolResult } from './types';

// create_bin — second half of the two-step write protocol for sub-bins.
//
// Same shape as create_task: this tool accepts ONLY a confirmation_token
// minted by preview_bin. Bin fields are not accepted here; the
// canonical input was stored server-side at preview time. The model
// has no surface to write a bin without first running preview_bin.

const inputSchema = z.object({
  confirmation_token: z
    .string()
    .uuid()
    .describe(
      'Single-use token from a recent preview_bin call. Required. Tokens are bound to the preview that issued them and expire after 5 minutes.',
    ),
});

type Input = z.infer<typeof inputSchema>;

export interface CreatedBinRow {
  bin_id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  sort_order: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /**
   * Deep link to the bins workspace. Today this points at the bins
   * index page (per-bin URLs aren't a thing yet); the user clicks the
   * new tile to drill in. Absolute when APP_BASE_URL is set.
   */
  bins_url: string;
}

async function handler(input: Input): Promise<ToolResult<CreatedBinRow>> {
  const consumed = consumeCreateBinToken(input.confirmation_token);
  if (!consumed.ok) {
    const reason = consumed.reason;
    return {
      ok: false,
      error: {
        code: 'confirmation_required',
        message:
          reason === 'expired'
            ? 'The confirmation token has expired. Tokens are valid for 5 minutes.'
            : 'No matching confirmation token. Tokens are issued only by preview_bin and are single-use.',
        hint:
          'Call preview_bin with the bin fields, present the plan to the user, get explicit confirmation, then call create_bin with the new confirmation_token.',
      },
    };
  }

  const result = await createBinService(consumed.input);
  if (!result.ok) {
    if (result.error.code === 'invalid_input') {
      return {
        ok: false,
        error: {
          code: 'invalid_input',
          message: result.error.message,
          hint: result.error.field
            ? `The "${result.error.field}" field is invalid. Re-confirm with the user via preview_bin.`
            : 'Re-confirm the bin fields with the user via preview_bin.',
        },
      };
    }
    if (result.error.code === 'duplicate_name') {
      // Possible if another sub-bin was created in the 5-minute preview
      // window. Tell the user; don't retry blindly.
      return {
        ok: false,
        error: {
          code: 'duplicate_name',
          message: result.error.message,
          hint: 'Another bin with this name was created between preview and commit. Pick a different name and call preview_bin again.',
        },
      };
    }
    if (result.error.code === 'not_found') {
      return {
        ok: false,
        error: {
          code: 'not_found',
          message: result.error.message,
          hint:
            'A referenced row may have been deleted between preview and commit. Re-run preview_bin.',
        },
      };
    }
    return {
      ok: false,
      error: { code: 'db_error', message: result.error.message },
    };
  }

  const b = result.bin;
  const row: CreatedBinRow = {
    bin_id: b.id,
    name: b.name,
    description: b.description,
    is_system: b.is_system,
    sort_order: b.sort_order,
    created_by: b.created_by,
    created_at: b.created_at,
    updated_at: b.updated_at,
    bins_url: binsIndexUrl(),
  };

  const meta: ToolMeta = { returned: 1, limit: 1, truncated: false };
  return { ok: true, data: row, meta };
}

export const createBin: ToolDefinition<Input, CreatedBinRow> = {
  name: 'create_bin',
  description:
    "COMMIT a sub-bin that was previewed and confirmed by the user. Takes ONLY a confirmation_token from a recent preview_bin call — bin fields are not accepted here. Required workflow: 1) call preview_bin with the bin fields → get a plan + token, 2) present the plan, ask for explicit confirmation, 3) only then call this tool with the token. Returns the created bin (including its bin_id, which is what you'd pass to preview_task / preview_tasks_batch to bin tasks into the new sub-bin) on success, or a confirmation_required error if the token is missing/expired/already-used.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      confirmation_token: {
        type: 'string',
        description:
          'Single-use token returned by preview_bin. Tokens expire 5 minutes after issuance. Required.',
      },
    },
    required: ['confirmation_token'],
    additionalProperties: false,
  },
  handler,
};
