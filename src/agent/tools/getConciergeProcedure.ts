import { z } from 'zod';
import { getConciergeTrainingForProperty } from '@/src/server/messages/conciergeTraining';
import type { ToolDefinition, ToolResult, ToolMeta, ToolContext } from './types';

// get_concierge_procedure — load the FULL steps of a situational concierge
// procedure on demand.
//
// The guest-reply draft pins "always" training (voice, privacy, emergencies)
// into context, but lists "situational" procedures (door lock, BabyQuip,
// maintenance, …) only by title in an index. When the guest's message matches
// one, the model calls this tool with the id(s) from that index to pull the
// full instructions, then follows them.
//
// Property is bound from ToolContext (ctx.draft.propertyId) — same posture as
// get_property_knowledge_for_guest. The model never supplies a property id, and
// the tool only ever returns SITUATIONAL rules for that property (it cannot be
// used to read always-tier rules or another property's training).

const inputSchema = z
  .object({
    ids: z
      .array(z.string().uuid())
      .min(1)
      .max(10)
      .optional()
      .describe('The [id: …] values from the situational-procedures index to load. Preferred.'),
    titles: z
      .array(z.string().min(2))
      .min(1)
      .max(10)
      .optional()
      .describe('Procedure titles to load, if you don\'t have the ids. Case-insensitive.'),
  })
  .refine((v) => (v.ids?.length ?? 0) + (v.titles?.length ?? 0) > 0, {
    message: 'Provide at least one id or title to load.',
    path: ['ids'],
  });

type Input = z.infer<typeof inputSchema>;

export interface ConciergeProcedure {
  id: string;
  title: string;
  instructions: string;
}

async function handler(input: Input, ctx: ToolContext): Promise<ToolResult<ConciergeProcedure[]>> {
  const propertyId = ctx.draft?.propertyId ?? null;
  const category = ctx.draft?.category ?? 'reply';

  try {
    // Same scoping as the draft's training fetch; then restrict to situational.
    const rules = await getConciergeTrainingForProperty(propertyId, category);
    const situational = rules.filter((r) => r.tier === 'situational');

    const idSet = new Set(input.ids ?? []);
    const titleTerms = (input.titles ?? []).map((t) => t.toLowerCase().trim());
    const matched = situational.filter((r) => {
      if (idSet.has(r.id)) return true;
      const t = r.title.toLowerCase();
      return titleTerms.some((term) => t.includes(term) || term.includes(t));
    });

    const requested = (input.ids?.length ?? 0) + (input.titles?.length ?? 0);
    const meta: ToolMeta = {
      returned: matched.length,
      // ToolMeta requires limit/truncated; there is no limit here, so echo
      // request size and never truncate.
      limit: requested,
      truncated: false,
      requested,
    };
    return {
      ok: true,
      data: matched.map((r) => ({ id: r.id, title: r.title, instructions: r.instructions })),
      meta,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load procedure';
    return { ok: false, error: { code: 'db_error', message } };
  }
}

export const getConciergeProcedure: ToolDefinition<Input, ConciergeProcedure[]> = {
  name: 'get_concierge_procedure',
  description:
    "Load the full step-by-step instructions for a situational procedure listed in the 'Situational procedures available on demand' index. Call it with the [id: …] value(s) from that index (or the title) BEFORE replying when the guest's latest message matches a listed procedure's topic — then follow the loaded steps. You can load several at once if more than one applies. It only returns those on-demand procedures for this property; the always-applies training (voice, privacy, emergencies, etc.) is already in context and never needs loading.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      ids: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 10,
        description: 'The [id: …] values from the situational-procedures index. Preferred.',
      },
      titles: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 10,
        description: "Procedure titles to load if you don't have the ids. Case-insensitive.",
      },
    },
    additionalProperties: false,
  },
  handler,
};
