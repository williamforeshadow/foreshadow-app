import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { getConversationContext } from '@/src/server/messages/conversationContext';
import { requireOrgId, type ToolContext, type ToolDefinition, type ToolResult } from './types';

// read_conversation_thread — the full message history for one guest conversation
// plus its linked reservation, so the agent can understand what a guest asked
// before drafting a reply (or, later, suggesting tasks from the thread).
// Resolve a guest/property to a conversation_id with find_conversations first.

const inputSchema = z.object({
  conversation_id: z
    .string()
    .uuid()
    .describe('Conversation UUID. Resolve a guest name or property with find_conversations first.'),
});

type Input = z.infer<typeof inputSchema>;

interface ThreadMessage {
  direction: 'inbound' | 'outbound';
  body: string;
  sent_at: string | null;
  /** True when sent_at is in the future — a scheduled host automation, not yet sent. */
  scheduled: boolean;
}

export interface ConversationThreadView {
  conversation_id: string;
  guest_name: string | null;
  property_name: string | null;
  channel: string | null;
  app_status: 'active' | 'complete';
  booking_state: 'inquiry' | 'booked' | 'cancelled';
  /**
   * The stay window: reservation dates when booked, otherwise the inquiry's
   * requested dates. `booked` distinguishes the two. Use these dates when
   * answering the guest — don't ask for dates that are already here.
   */
  stay: {
    check_in: string | null;
    check_out: string | null;
    nights: number | null;
    booked: boolean;
  };
  messages: ThreadMessage[];
}

async function handler(
  input: Input,
  toolCtx: ToolContext,
): Promise<ToolResult<ConversationThreadView>> {
  const org = requireOrgId(toolCtx);
  if (typeof org !== 'string') return org;

  // Validate the conversation belongs to the caller's org BEFORE reading the
  // thread (full guest message history + linked reservation). getConversationContext
  // is org-blind, and conversation_id here is model-supplied — reject cross-org.
  const { data: convRow, error: convErr } = await getSupabaseServer()
    .from('conversations')
    .select('id')
    .eq('id', input.conversation_id)
    .eq('org_id', org)
    .maybeSingle();
  if (convErr) {
    return { ok: false, error: { code: 'db_error', message: convErr.message } };
  }
  if (!convRow) {
    return {
      ok: false,
      error: {
        code: 'not_found',
        message: `No conversation with id ${input.conversation_id}.`,
        hint: 'Call find_conversations to resolve a guest name or property to a conversation id.',
      },
    };
  }

  let convo;
  try {
    convo = await getConversationContext(input.conversation_id);
  } catch (err) {
    return {
      ok: false,
      error: { code: 'db_error', message: err instanceof Error ? err.message : 'Failed to read conversation' },
    };
  }
  if (!convo) {
    return {
      ok: false,
      error: {
        code: 'not_found',
        message: `No conversation with id ${input.conversation_id}.`,
        hint: 'Call find_conversations to resolve a guest name or property to a conversation id.',
      },
    };
  }

  const nowMs = Date.now();
  const messages: ThreadMessage[] = convo.messages.map((m) => ({
    direction: m.direction,
    body: (m.body ?? '').trim(),
    sent_at: m.sent_at,
    scheduled: !!m.sent_at && new Date(m.sent_at).getTime() > nowMs,
  }));

  const view: ConversationThreadView = {
    conversation_id: convo.conversation.id,
    guest_name: convo.reservation?.guest_name ?? convo.conversation.guest_name,
    property_name: convo.reservation?.property_name ?? convo.conversation.property_name,
    channel: convo.conversation.channel,
    app_status: convo.conversation.app_status,
    booking_state: convo.conversation.booking_state,
    stay: {
      check_in: convo.stay.check_in,
      check_out: convo.stay.check_out,
      nights: convo.stay.nights,
      booked: convo.stay.booked,
    },
    messages,
  };

  return {
    ok: true,
    data: view,
    meta: { returned: messages.length, limit: messages.length, truncated: false },
  };
}

export const readConversationThread: ToolDefinition<Input, ConversationThreadView> = {
  name: 'read_conversation_thread',
  description:
    "Read a guest conversation's full message history plus its linked reservation (guest, property, check-in/out). Use this to understand what a guest asked before handing the conversation to the concierge tool. Messages are oldest-first; a message marked scheduled=true is a future-dated host automation that hasn't been sent yet. Resolve a guest name or property to a conversation_id with find_conversations first.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      conversation_id: {
        type: 'string',
        description: 'Conversation UUID. Resolve with find_conversations first.',
      },
    },
    required: ['conversation_id'],
    additionalProperties: false,
  },
  handler,
};
