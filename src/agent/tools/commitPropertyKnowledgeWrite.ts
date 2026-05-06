import { z } from 'zod';
import {
  commitPropertyKnowledgeWrite,
  type PropertyKnowledgeWritePlan,
} from '@/src/server/properties/propertyKnowledgeWrite';
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
  plan: PropertyKnowledgeWritePlan;
  row: unknown;
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

  const result = await commitPropertyKnowledgeWrite(consumed.input);
  if (!result.ok) {
    return {
      ok: false,
      error: {
        code: result.error.code,
        message: result.error.message,
        hint: result.error.field
          ? `The "${result.error.field}" field is invalid. Re-run preview_property_knowledge_write.`
          : 'Re-run preview_property_knowledge_write.',
      },
    };
  }

  const meta: ToolMeta = { returned: 1, limit: 1, truncated: false };
  return { ok: true, data: { plan: result.plan, row: result.row }, meta };
}

export const commitPropertyKnowledgeWriteTool: ToolDefinition<
  Input,
  CommitPropertyKnowledgeWriteData
> = {
  name: 'commit_property_knowledge_write',
  description:
    'COMMIT a previewed-and-confirmed Property Knowledge write. Takes ONLY a confirmation_token from preview_property_knowledge_write. Use after the user explicitly confirms the preview plan. Returns the applied plan and resulting/deleted row snapshot.',
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
