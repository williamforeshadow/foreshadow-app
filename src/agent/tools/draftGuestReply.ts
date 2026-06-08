import { z } from 'zod';
import { generateGuestReplyDraft } from '@/src/server/messages/draftReply';
import type { ToolDefinition, ToolResult } from './types';

// draft_guest_reply — generate a warm, on-brand reply draft for a guest
// conversation. This DRAFTS only; it does not send. The draft is for a human to
// review, edit, and send. Voice + grounding rules live in the generator
// (src/server/messages/draftReply.ts), not here.
//
// Not a write tool: no preview/commit, no pending action, not in
// WRITE_TOOL_NAMES — producing text isn't a state mutation.

const inputSchema = z.object({
  conversation_id: z
    .string()
    .uuid()
    .describe('Conversation UUID to draft a reply for. Resolve with find_conversations first.'),
  context_notes: z
    .string()
    .optional()
    .describe(
      'Facts to ground the reply, gathered from other tools (e.g. get_property_knowledge for wifi/check-in/access). The draft will only use facts present here, in the thread, or in the reservation — it will not invent specifics. Pass property facts here when the guest asked something property-specific.',
    ),
  guidance: z
    .string()
    .optional()
    .describe(
      "What the reply should convey, when the user told you (e.g. 'let them know checkout is 11am and the cleaners charge $20 for a luggage hold'). Omit to simply draft a helpful reply to the latest guest message.",
    ),
});

type Input = z.infer<typeof inputSchema>;

async function handler(input: Input): Promise<ToolResult<{ draft: string }>> {
  try {
    const { draft } = await generateGuestReplyDraft({
      conversationId: input.conversation_id,
      contextNotes: input.context_notes,
      guidance: input.guidance,
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

export const draftGuestReply: ToolDefinition<Input, { draft: string }> = {
  name: 'draft_guest_reply',
  description:
    "Generate a warm, on-brand DRAFT reply to a guest conversation. Does NOT send — return the draft to the user as a proposed message they can edit and send. Usually call read_conversation_thread first to understand the thread. If the guest asked something property-specific, call get_property_knowledge first and pass the facts via context_notes. Pass guidance when the user told you what to say. The draft never invents booking/property specifics.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      conversation_id: {
        type: 'string',
        description: 'Conversation UUID to draft a reply for. Resolve with find_conversations first.',
      },
      context_notes: {
        type: 'string',
        description:
          'Facts to ground the reply, gathered from other tools (e.g. get_property_knowledge). The draft only uses facts here, in the thread, or in the reservation.',
      },
      guidance: {
        type: 'string',
        description: "What the reply should convey, when the user specified it. Omit to draft a reply to the latest guest message.",
      },
    },
    required: ['conversation_id'],
    additionalProperties: false,
  },
  handler,
};
