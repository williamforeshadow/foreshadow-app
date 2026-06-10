import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabaseServer';
import {
  getConciergeTrainingForProperty,
  type TrainingRule,
} from '@/src/server/messages/conciergeTraining';
import type { ToolDefinition, ToolResult, ToolMeta } from './types';

// find_concierge_training — read the configured operating procedures ("agent
// intelligence") for a property: named playbooks the host's team follows for
// recurring guest situations (door lock issues, parking, check-in, etc).
//
// Read-only. NOT in WRITE_TOOL_NAMES. Note that the concierge tool already
// auto-incorporates a property's training, so this tool is for the operator
// asking "what's our procedure for X" — and is the foundation for a future
// add/update_concierge_training write tool.

const inputSchema = z
  .object({
    property_id: z
      .string()
      .uuid()
      .optional()
      .describe('Property UUID to load training for. Resolve a name with find_properties.'),
    conversation_id: z
      .string()
      .uuid()
      .optional()
      .describe("A conversation UUID; its linked property is used. Handy when you're already in a thread."),
    query: z
      .string()
      .min(2)
      .optional()
      .describe('Case-insensitive substring filter on rule title/instructions (e.g. "lock", "parking").'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe('Max rules. Default 20, hard cap 50.'),
  })
  .describe('Provide property_id or conversation_id to scope to a property. With neither, only global (all-property) rules are returned.');

type Input = z.infer<typeof inputSchema>;

const DEFAULT_LIMIT = 20;

async function resolvePropertyId(input: Input): Promise<string | null> {
  if (input.property_id) return input.property_id;
  if (input.conversation_id) {
    const { data, error } = await getSupabaseServer()
      .from('conversations')
      .select('property_id')
      .eq('id', input.conversation_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as { property_id: string | null } | null)?.property_id ?? null;
  }
  return null;
}

async function handler(input: Input): Promise<ToolResult<TrainingRule[]>> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  try {
    const propertyId = await resolvePropertyId(input);
    let rules = await getConciergeTrainingForProperty(propertyId);

    if (input.query) {
      const term = input.query.toLowerCase();
      rules = rules.filter(
        (r) =>
          r.title.toLowerCase().includes(term) ||
          r.instructions.toLowerCase().includes(term),
      );
    }

    const truncated = rules.length > limit;
    const trimmed = truncated ? rules.slice(0, limit) : rules;
    const meta: ToolMeta = { returned: trimmed.length, limit, truncated };
    return { ok: true, data: trimmed, meta };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load concierge training';
    return { ok: false, error: { code: 'db_error', message } };
  }
}

export const findConciergeTraining: ToolDefinition<Input, TrainingRule[]> = {
  name: 'find_concierge_training',
  description:
    "Read the configured concierge training (operating procedures / playbooks) for a property — the host team's instructions for recurring guest situations like door-lock issues, parking, or check-in. Scope with property_id or conversation_id; with neither, returns only global rules that apply to every property. Use 'query' to filter by topic. Read-only. Note: the concierge tool already applies a property's training automatically, so reach for this when the operator asks what a procedure is, or to confirm what's configured.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      property_id: {
        type: 'string',
        description: 'Property UUID to load training for. Resolve a name with find_properties.',
      },
      conversation_id: {
        type: 'string',
        description: 'A conversation UUID; its linked property is used.',
      },
      query: {
        type: 'string',
        minLength: 2,
        description: 'Case-insensitive substring filter on rule title/instructions (e.g. "lock").',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 50,
        description: 'Max rules. Default 20.',
      },
    },
    additionalProperties: false,
  },
  handler,
};
