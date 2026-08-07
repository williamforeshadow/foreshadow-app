import { z } from 'zod';
import {
  commitPropertyKnowledgeOperations,
  type PropertyKnowledgeOperationsCommitResult,
} from '@/src/server/properties/propertyKnowledgeOperations';
import { consumePropertyKnowledgeWriteToken } from '@/src/server/properties/propertyKnowledgeWriteConfirmation';
import type { ToolDefinition, ToolMeta, ToolResult } from './types';

const inputSchema = z.object({
  confirmation_token: z
    .string()
    .uuid()
    .describe(
      'Single-use token returned by preview_property_knowledge_write. Tokens expire after 5 minutes.',
    ),
});

type Input = z.infer<typeof inputSchema>;

export interface CommitPropertyKnowledgeWriteData {
  result: PropertyKnowledgeOperationsCommitResult;
}

async function handler(
  input: Input,
): Promise<ToolResult<CommitPropertyKnowledgeWriteData>> {
  const consumed = consumePropertyKnowledgeWriteToken(input.confirmation_token);
  if (!consumed.ok) {
    return {
      ok: false,
      error: {
        code: 'confirmation_required',
        message:
          consumed.reason === 'expired'
            ? 'The confirmation token has expired. Tokens are valid for 5 minutes.'
            : 'No matching confirmation token. Tokens are issued only by preview_property_knowledge_write and are single-use.',
        hint:
          'Call preview_property_knowledge_write, present the plan to the user, get explicit confirmation, then call this tool with the new token.',
      },
    };
  }

  const committed = await commitPropertyKnowledgeOperations(consumed.input);
  if (!committed.ok) {
    return {
      ok: false,
      error: {
        code: committed.error.code,
        message: committed.error.message,
        hint: committed.error.field
          ? `The "${committed.error.field}" field is invalid. Re-run preview_property_knowledge_write.`
          : 'Re-run preview_property_knowledge_write.',
      },
    };
  }

  // ok:true with a non-empty failures array is a PARTIAL success — operations
  // that depended on a failure were skipped while independent ones still ran.
  const result = committed.result;
  const meta: ToolMeta = {
    returned: result.results.length,
    limit: result.results.length,
    truncated: false,
  };
  return { ok: true, data: { result }, meta };
}

export const commitPropertyKnowledgeWriteTool: ToolDefinition<
  Input,
  CommitPropertyKnowledgeWriteData
> = {
  name: 'commit_property_knowledge_write',
  description:
    'COMMIT a previewed-and-confirmed Property Knowledge operations plan. Takes ONLY a confirmation_token from preview_property_knowledge_write. Use after the user explicitly confirms. Returns a per-operation result: each operation with its actual mode, the rows written, the photos attached, a failures array, and a drift array. This can return ok:true WITH failures — operations run in order, so a failure skips the operations that depended on it while independent ones still land. Narrate that split honestly rather than claiming full success, and mention any drift (e.g. a room that was planned as a create but existed by the time it ran).',
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      confirmation_token: {
        type: 'string',
        description:
          'Single-use token from preview_property_knowledge_write. Required.',
      },
    },
    required: ['confirmation_token'],
    additionalProperties: false,
  },
  handler,
};
