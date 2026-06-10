import { z } from 'zod';
import { generateGuestReplyDraft } from '@/src/server/messages/draftReply';
import type { ToolDefinition, ToolResult } from './types';

// concierge — the ops agent's handle to the guest-facing Concierge sub-agent.
// The ops agent NEVER writes to guests itself; it delegates here. This runs the
// whole Concierge loop (guest voice, unlocked-only property knowledge, concierge
// training) and returns a proposed reply. DRAFTS only — nothing is sent.
//
// The Concierge gathers its own facts (gated to what the org has unlocked for
// guests), so the ops agent passes only intent, never property facts. Voice +
// grounding live in the generator (src/server/messages/draftReply.ts).
//
// Not a write tool: producing text isn't a state mutation. (When the Concierge
// later gains action tools — task creation, escalation, send — those will carry
// their own confirmation semantics.)

const inputSchema = z.object({
  conversation_id: z
    .string()
    .uuid()
    .describe('Conversation UUID to handle. Resolve a guest name / property with find_conversations first.'),
  instruction: z
    .string()
    .optional()
    .describe(
      "Plain-English directive for what the operator wants said to, or done for, the guest (e.g. 'let them know checkout is 11am'). Intent only — the Concierge decides the wording and grounds it itself. Do NOT pass property facts, codes, wifi, or internal notes here; the Concierge retrieves what it's allowed to share. Omit to simply reply to the latest guest message.",
    ),
});

type Input = z.infer<typeof inputSchema>;

async function handler(input: Input): Promise<ToolResult<{ draft: string }>> {
  try {
    const { draft } = await generateGuestReplyDraft({
      conversationId: input.conversation_id,
      instruction: input.instruction,
    });
    return { ok: true, data: { draft } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to draft a reply';
    const notFound = /not found/i.test(message);
    return {
      ok: false,
      error: {
        code: notFound ? 'not_found' : 'db_error',
        message,
        ...(notFound
          ? { hint: 'Call find_conversations to resolve the guest/property to a valid conversation_id.' }
          : {}),
      },
    };
  }
}

export const concierge: ToolDefinition<Input, { draft: string }> = {
  name: 'concierge',
  description:
    "Hand a guest-facing job to the Concierge — the separate guest-facing agent that writes and (eventually) sends messages to guests. Use this whenever the operator wants something said to, or done for, a guest. Pass the conversation_id and a plain-English instruction of the intent; the Concierge grounds the reply in the property's guest-shareable (unlocked) knowledge and any concierge training on its own — do NOT fetch or pass property facts yourself. Returns a proposed draft for the operator to review (nothing is sent). Usually call read_conversation_thread first if you need to understand the thread.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      conversation_id: {
        type: 'string',
        description: 'Conversation UUID to handle. Resolve with find_conversations first.',
      },
      instruction: {
        type: 'string',
        description:
          "Plain-English intent for what to say to / do for the guest (e.g. 'let them know checkout is 11am'). Do NOT pass property facts/codes/wifi — the Concierge retrieves what it's allowed to share. Omit to reply to the latest guest message.",
      },
    },
    required: ['conversation_id'],
    additionalProperties: false,
  },
  handler,
};
