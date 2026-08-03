import { z } from 'zod';
import {
  commitPropertyContactBatch,
  type PropertyContactBatchCommitResult,
  type PropertyContactBatchPlan,
} from '@/src/server/properties/propertyContactBatch';
import { consumePropertyContactBatchToken } from '@/src/server/properties/propertyContactConfirmation';
import type { ToolDefinition, ToolMeta, ToolResult } from './types';

const inputSchema = z.object({
  confirmation_token: z
    .string()
    .uuid()
    .describe(
      'Single-use token returned by preview_property_contact_batch. Tokens expire after 5 minutes.',
    ),
});

type Input = z.infer<typeof inputSchema>;

export interface CommitPropertyContactBatchData {
  plan: PropertyContactBatchPlan;
  results: PropertyContactBatchCommitResult[];
  failures: PropertyContactBatchCommitResult[];
}

async function handler(
  input: Input,
): Promise<ToolResult<CommitPropertyContactBatchData>> {
  const consumed = consumePropertyContactBatchToken(input.confirmation_token);
  if (!consumed.ok) {
    return {
      ok: false,
      error: {
        code: 'confirmation_required',
        message:
          consumed.reason === 'expired'
            ? 'The confirmation token has expired. Tokens are valid for 5 minutes.'
            : 'No matching confirmation token. Tokens are issued only by preview_property_contact_batch and are single-use.',
        hint: 'Call preview_property_contact_batch, present the plan to the user, get explicit confirmation, then call this tool with the new token.',
      },
    };
  }

  const result = await commitPropertyContactBatch(consumed.input);
  if (!result.ok) {
    return {
      ok: false,
      error: {
        code: result.error.code,
        message: result.error.message,
        hint: 'Re-run preview_property_contact_batch.',
      },
    };
  }

  // Each property commits independently, so partial success is a real outcome:
  // ok:true with a populated failures array, same contract as create_tasks_batch.
  const meta: ToolMeta = {
    returned: result.results.length,
    limit: consumed.input.property_ids.length,
    truncated: false,
  };
  return {
    ok: true,
    data: { plan: result.plan, results: result.results, failures: result.failures },
    meta,
  };
}

export const commitPropertyContactBatchTool: ToolDefinition<
  Input,
  CommitPropertyContactBatchData
> = {
  name: 'commit_property_contact_batch',
  description:
    'COMMIT a previewed-and-confirmed property contact BATCH. Takes ONLY a confirmation_token from preview_property_contact_batch (tokens from preview_property_contact_upsert are NOT accepted). May return ok:true with a non-empty failures array when some properties landed and others did not — when that happens, say which succeeded and which failed and why. Do not claim full success.',
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      confirmation_token: {
        type: 'string',
        description: 'Single-use token from preview_property_contact_batch. Required.',
      },
    },
    required: ['confirmation_token'],
    additionalProperties: false,
  },
  handler,
};
