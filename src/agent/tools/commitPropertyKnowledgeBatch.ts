import { z } from 'zod';
import {
  commitPropertyKnowledgeBatch,
  type PropertyKnowledgeBatchPropertyResult,
} from '@/src/server/properties/propertyKnowledgeWriteBatch';
import { consumePropertyKnowledgeBatchToken } from '@/src/server/properties/propertyKnowledgeWriteConfirmation';
import type { ToolDefinition, ToolMeta, ToolResult } from './types';

const inputSchema = z.object({
  confirmation_token: z
    .string()
    .uuid()
    .describe(
      'Single-use token returned by preview_property_knowledge_batch. Tokens expire after 5 minutes.',
    ),
});

type Input = z.infer<typeof inputSchema>;

export interface CommitPropertyKnowledgeBatchData {
  results: PropertyKnowledgeBatchPropertyResult[];
  failures: PropertyKnowledgeBatchPropertyResult[];
  summary: string;
}

async function handler(
  input: Input,
): Promise<ToolResult<CommitPropertyKnowledgeBatchData>> {
  const consumed = consumePropertyKnowledgeBatchToken(input.confirmation_token);
  if (!consumed.ok) {
    return {
      ok: false,
      error: {
        code: 'confirmation_required',
        message:
          consumed.reason === 'expired'
            ? 'The confirmation token has expired. Tokens are valid for 5 minutes.'
            : 'No matching confirmation token. Tokens are issued only by preview_property_knowledge_batch and are single-use.',
        hint: 'Call preview_property_knowledge_batch, present the plan to the user, get explicit confirmation, then call this tool with the new token.',
      },
    };
  }

  const result = await commitPropertyKnowledgeBatch(consumed.input);
  if (!result.ok) {
    return {
      ok: false,
      error: {
        code: result.error.code,
        message: result.error.message,
        hint: 'Re-run preview_property_knowledge_batch.',
      },
    };
  }

  // Partial success is a real outcome here, at two levels: each property commits
  // independently, and within a property each operation does too. Returned as
  // ok:true with a populated failures array — the same contract as
  // create_tasks_batch, which the write protocol already tells the model to
  // narrate honestly.
  const meta: ToolMeta = {
    returned: result.results.length,
    limit: consumed.input.property_ids.length,
    truncated: false,
  };
  return {
    ok: true,
    data: {
      results: result.results,
      failures: result.failures,
      summary: result.summary,
    },
    meta,
  };
}

export const commitPropertyKnowledgeBatchTool: ToolDefinition<
  Input,
  CommitPropertyKnowledgeBatchData
> = {
  name: 'commit_property_knowledge_batch',
  description:
    'COMMIT a previewed-and-confirmed Property Knowledge BATCH. Takes ONLY a confirmation_token from preview_property_knowledge_batch (tokens from preview_property_knowledge_write are NOT accepted). Runs the operations list against every property in order, creating any missing rooms first. Partial success happens at two levels and both must be narrated: a property can fail while others land, and within a property an operation can fail while the operations that did not depend on it still land. May return ok:true with a non-empty failures array — when that happens, say which properties and which operations succeeded and which did not. Do not claim full success.',
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      confirmation_token: {
        type: 'string',
        description:
          'Single-use token from preview_property_knowledge_batch. Required.',
      },
    },
    required: ['confirmation_token'],
    additionalProperties: false,
  },
  handler,
};
