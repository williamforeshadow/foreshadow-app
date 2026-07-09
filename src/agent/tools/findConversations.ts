import { z } from 'zod';
import { requireOrgId, type ToolContext, type ToolDefinition, type ToolResult, type ToolMeta } from './types';

// find_conversations — resolve a guest conversation (the messaging inbox row) by
// guest name, property, status, or recency. The entry point for "draft a reply
// to Wendy" style requests: get the conversation_id here, then
// read_conversation_thread / concierge.

const inputSchema = z
  .object({
    guest_name: z
      .string()
      .min(2)
      .optional()
      .describe('Case-insensitive substring match on the guest name. Minimum 2 characters.'),
    property_name: z
      .string()
      .min(2)
      .optional()
      .describe('Case-insensitive substring match on the property name.'),
    status: z
      .enum(['active', 'complete'])
      .optional()
      .describe("Filter by inbox status: 'active' is the open working set, 'complete' is resolved threads. Omit to return BOTH (the handler applies no status filter when this is unset)."),
    unread_only: z
      .boolean()
      .optional()
      .describe('When true, only conversations with unread guest messages.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe('Max rows. Default 20, hard cap 50.'),
  })
  .describe('All filters optional. With none, returns the most recent non-archived conversations (active and complete).');

type Input = z.infer<typeof inputSchema>;

export interface ConversationMatch {
  conversation_id: string;
  guest_name: string | null;
  property_name: string | null;
  channel: string | null;
  app_status: 'active' | 'complete';
  unread: boolean;
  last_message_at: string | null;
  last_direction: 'inbound' | 'outbound' | null;
  last_message_preview: string;
}

const DEFAULT_LIMIT = 20;

function sanitize(raw: string): string {
  return raw.replace(/[%_,()\\]/g, ' ').trim();
}

async function handler(
  input: Input,
  ctx: ToolContext,
): Promise<ToolResult<ConversationMatch[]>> {
  const org = requireOrgId(ctx);
  if (typeof org !== 'string') return org;

  const limit = input.limit ?? DEFAULT_LIMIT;
  const supabase = ctx.db;

  let q = supabase
    .from('conversations')
    .select(
      'id, guest_name, property_name, channel, app_status, unread, last_message_at, last_direction, last_message_preview',
    )
    .eq('org_id', org)
    .eq('archived', false)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(limit + 1);

  if (input.status) q = q.eq('app_status', input.status);
  if (input.unread_only) q = q.eq('unread', true);
  if (input.guest_name) {
    const term = sanitize(input.guest_name);
    if (term) q = q.ilike('guest_name', `%${term}%`);
  }
  if (input.property_name) {
    const term = sanitize(input.property_name);
    if (term) q = q.ilike('property_name', `%${term}%`);
  }

  const { data, error } = await q;
  if (error) {
    return { ok: false, error: { code: 'db_error', message: error.message } };
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const truncated = rows.length > limit;
  const trimmed = truncated ? rows.slice(0, limit) : rows;
  // Surface what scoping actually ran. With no `status`, this returns BOTH
  // active and complete (only archived rows are excluded) — make that
  // explicit so the model doesn't assume it only saw active threads.
  const statusFilter = input.status ?? 'all (active + complete)';

  const matches: ConversationMatch[] = trimmed.map((r) => ({
    conversation_id: r.id as string,
    guest_name: (r.guest_name as string | null) ?? null,
    property_name: (r.property_name as string | null) ?? null,
    channel: (r.channel as string | null) ?? null,
    app_status: r.app_status as 'active' | 'complete',
    unread: Boolean(r.unread),
    last_message_at: (r.last_message_at as string | null) ?? null,
    last_direction: (r.last_direction as 'inbound' | 'outbound' | null) ?? null,
    last_message_preview: (r.last_message_preview as string | null) ?? '',
  }));

  const meta: ToolMeta = {
    returned: matches.length,
    limit,
    truncated,
    status_filter: statusFilter,
    archived: 'excluded',
  };
  return { ok: true, data: matches, meta };
}

export const findConversations: ToolDefinition<Input, ConversationMatch[]> = {
  name: 'find_conversations',
  description:
    "Find guest message conversations (inbox threads) by guest name, property, status, or recency. Use this to resolve a guest name to a conversation_id before reading the thread or drafting a reply. Returns slim rows sorted by most recent activity (last_message_at desc). Archived threads are always excluded. With no `status` filter it returns BOTH active and complete conversations (meta.status_filter records what ran); pass status:'active' to scope to the open working set.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      guest_name: {
        type: 'string',
        minLength: 2,
        description: 'Case-insensitive substring match on the guest name. Minimum 2 characters.',
      },
      property_name: {
        type: 'string',
        minLength: 2,
        description: 'Case-insensitive substring match on the property name.',
      },
      status: {
        type: 'string',
        enum: ['active', 'complete'],
        description: "Filter by inbox status: 'active' is the open working set, 'complete' is resolved threads. Omit to return BOTH (no status filter is applied when unset).",
      },
      unread_only: {
        type: 'boolean',
        description: 'When true, only conversations with unread guest messages.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 50,
        description: 'Max rows. Default 20.',
      },
    },
    additionalProperties: false,
  },
  handler,
};
