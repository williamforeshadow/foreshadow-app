import { z } from 'zod';
import { loadPropertyKnowledge, type PropertyKnowledge } from '@/src/server/properties/propertyKnowledge';
import type { ToolDefinition, ToolResult } from './types';

// get_property_knowledge — full per-property dossier (ops-facing).
//
// The shared loader (src/server/properties/propertyKnowledge.ts) runs the
// 8-read query every "Knowledge" tab exposes. This tool returns it whole — codes,
// credentials, everything — because the ops agent must reason over all of it. The
// guest-facing Concierge uses get_property_knowledge_for_guest instead, which
// filters the same loader output to the unlocked allowlist.
//
// The model is expected to call find_properties first to resolve a name into
// a property_id, then call this tool exactly once per property.

const inputSchema = z.object({
  property_id: z
    .string()
    .uuid()
    .describe('Canonical property UUID. Use find_properties to resolve a name into an id.'),
});

type Input = z.infer<typeof inputSchema>;

export type { PropertyKnowledge };

async function handler(input: Input): Promise<ToolResult<PropertyKnowledge>> {
  let data: PropertyKnowledge | null;
  try {
    data = await loadPropertyKnowledge(input.property_id);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load property knowledge';
    return { ok: false, error: { code: 'db_error', message } };
  }
  if (!data) {
    return {
      ok: false,
      error: {
        code: 'not_found',
        message: `No property found with id ${input.property_id}`,
        hint: 'Use find_properties to look up a valid property id by name.',
      },
    };
  }
  return { ok: true, data };
}

export const getPropertyKnowledge: ToolDefinition<Input, PropertyKnowledge> = {
  name: 'get_property_knowledge',
  description:
    'Fetch everything Foreshadow knows about a single property in one call: profile (address, beds/baths, Hostaway link), access codes and parking, wifi and tech-account credentials, vendor contacts (with tags, schedule, owner preferences), interior + exterior rooms with their attributes, and documents. Use after find_properties has resolved a name into a property_id. Photos return as storage paths only.',
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      property_id: {
        type: 'string',
        description:
          'Canonical property UUID. Resolve names to ids with find_properties first.',
      },
    },
    required: ['property_id'],
    additionalProperties: false,
  },
  handler,
};
