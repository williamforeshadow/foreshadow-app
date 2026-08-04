import { z } from 'zod';
import { requireOrgId, type ToolContext, type ToolDefinition, type ToolResult, type ToolMeta } from './types';
import { embedQueryCached, toVectorLiteral } from '@/src/server/search/embeddingClient';

// find_conversations — resolve a guest conversation (the messaging inbox row) by
// guest name, property, what was SAID in it, status, or recency. The entry point
// for "draft a reply to Wendy" style requests: get the conversation_id here, then
// read_conversation_thread / concierge.
//
// `search` is the content half, and it closes the largest retrieval gap in the
// product. guest_messages holds thousands of message bodies spanning years, and
// none of it was reachable — this tool could match a guest name and a property
// name and nothing else, so "which guest complained about noise?" had no path
// to an answer at all. It now trigram-matches message bodies via the
// search_conversations() RPC, ranked by relevance x recency on last_message_at.
//
// Unlike find_tasks (where a comment match returns only matched_in and get_task
// does the reading), a message match returns the matching LINE inline. The text
// is short, it is the entire reason the row came back, and making the model open
// the thread to learn what it already searched for would be a wasted round trip.
// read_conversation_thread is still the tool for the full history.

const inputSchema = z
  .object({
    search: z
      .string()
      .min(2)
      .optional()
      .describe(
        'Fuzzy, RANKED free-text search across guest MESSAGE BODIES, guest name, and property name. This is the only way to find a thread by what was actually said in it. Tolerates typos and partial words, so pass the user\'s own wording. Matching rows carry matched_excerpt (the matching line) and matched_direction (inbound = the guest wrote it, outbound = you did).',
      ),
    guest_name: z
      .string()
      .min(2)
      .optional()
      .describe('Case-insensitive substring match on the guest name. Minimum 2 characters. Use `search` instead when the user is describing what was said rather than naming a guest.'),
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
  /** Searched results only: 'message' | 'guest_name' | 'property_name'. */
  matched_in?: string;
  /**
   * Searched results only, and only when a MESSAGE produced the hit: the
   * best-matching line of that message. Not the message's opening — these
   * threads are full of welcome templates that all begin the same way, so the
   * head of the body is almost never the part that matched.
   */
  matched_excerpt?: string | null;
  /**
   * Searched results only: who wrote the matching message. 'inbound' means the
   * guest said it, 'outbound' means the host did. This is what separates
   * "which guest complained about noise" from "what did we tell them about
   * noise" — the same words, opposite questions.
   */
  matched_direction?: string | null;
  /** Searched results only: relevance x recency, roughly 0-1. */
  match_score?: number;
}

/** One ranked candidate from the search_conversations() database function. */
interface RankedConversation {
  conversation_id: string;
  score: number;
  matched_in: string;
  matched_excerpt: string | null;
  matched_direction: string | null;
}

const DEFAULT_LIMIT = 20;
// Ranked candidates pulled before the tool's own filters (status, unread)
// narrow them. Larger than the row limit so a search scoped to unread-only
// still has candidates left to fill a page.
const SEARCH_CANDIDATE_CAP = 100;

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

  // Ranked content search runs first so its ordered candidate list can both
  // scope the query and re-sort what comes back.
  let searchRank: Map<string, RankedConversation> | undefined;
  if (input.search) {
    // Passed as an RPC parameter rather than interpolated into a PostgREST
    // filter string, so no sanitizing is needed here.
    // Semantic channel. Null (unconfigured key, provider down) makes the RPC
    // skip its vector CTE, degrading to exactly the previous trigram behaviour.
    const embedding = await embedQueryCached(input.search.trim());
    const { data: ranked, error: rankErr } = await supabase.rpc(
      'search_conversations',
      {
        p_org: org,
        p_query: input.search.trim(),
        p_limit: SEARCH_CANDIDATE_CAP,
        p_query_embedding: embedding ? toVectorLiteral(embedding) : null,
      },
    );
    if (rankErr) {
      return { ok: false, error: { code: 'db_error', message: rankErr.message } };
    }
    const matches = (ranked ?? []) as RankedConversation[];
    if (matches.length === 0) {
      // Loud empty. Without an id filter the main query would happily return
      // every recent conversation, which reads to the model as "here are your
      // matches" when nothing matched at all.
      return {
        ok: true,
        data: [],
        meta: {
          returned: 0,
          limit,
          truncated: false,
          search_ranked: true,
          search_matches: 0,
        },
      };
    }
    searchRank = new Map(matches.map((m) => [m.conversation_id, m]));
  }

  let q = supabase
    .from('conversations')
    .select(
      'id, guest_name, property_name, channel, app_status, unread, last_message_at, last_direction, last_message_preview',
    )
    .eq('org_id', org)
    .eq('archived', false)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    // When searching, pull the whole candidate set: the rows must be re-sorted
    // by relevance before they're trimmed, and taking limit+1 here would keep
    // the most RECENT matches and then "rank" only those.
    .limit(searchRank ? SEARCH_CANDIDATE_CAP : limit + 1);

  if (searchRank) q = q.in('id', Array.from(searchRank.keys()));
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
  // Re-apply relevance order; the database returned these by last_message_at
  // because PostgREST cannot sort by the RPC's score.
  if (searchRank) {
    rows.sort(
      (a, b) =>
        (searchRank.get(b.id as string)?.score ?? 0) -
        (searchRank.get(a.id as string)?.score ?? 0),
    );
  }
  const truncated = rows.length > limit;
  const trimmed = truncated ? rows.slice(0, limit) : rows;
  // Surface what scoping actually ran. With no `status`, this returns BOTH
  // active and complete (only archived rows are excluded) — make that
  // explicit so the model doesn't assume it only saw active threads.
  const statusFilter = input.status ?? 'all (active + complete)';

  const matches: ConversationMatch[] = trimmed.map((r) => {
    const hit = searchRank?.get(r.id as string);
    return {
      conversation_id: r.id as string,
      guest_name: (r.guest_name as string | null) ?? null,
      property_name: (r.property_name as string | null) ?? null,
      channel: (r.channel as string | null) ?? null,
      app_status: r.app_status as 'active' | 'complete',
      unread: Boolean(r.unread),
      last_message_at: (r.last_message_at as string | null) ?? null,
      last_direction: (r.last_direction as 'inbound' | 'outbound' | null) ?? null,
      last_message_preview: (r.last_message_preview as string | null) ?? '',
      ...(hit
        ? {
            matched_in: hit.matched_in,
            matched_excerpt: hit.matched_excerpt,
            matched_direction: hit.matched_direction,
            match_score: Math.round((hit.score ?? 0) * 100) / 100,
          }
        : {}),
    };
  });

  const meta: ToolMeta = {
    returned: matches.length,
    limit,
    truncated,
    status_filter: statusFilter,
    archived: 'excluded',
    ...(searchRank
      ? { search_ranked: true, search_candidates: searchRank.size }
      : {}),
  };
  return { ok: true, data: matches, meta };
}

export const findConversations: ToolDefinition<Input, ConversationMatch[]> = {
  name: 'find_conversations',
  description:
    "Find guest message conversations (inbox threads) by what was SAID in them, or by guest name, property, status, or recency. Use this to resolve a conversation_id before reading the thread or drafting a reply. `search` is the important one: it fuzzy-matches the actual MESSAGE BODIES (plus guest and property names) and is the only way to find a thread by its content — 'which guest asked about parking', 'who complained about noise', 'did anyone mention a broken TV'. It tolerates typos and partial words, so pass the user's own phrasing. Searched rows come back best-match-first (meta.search_ranked) weighted toward recent activity, and each carries match_score, matched_in, matched_excerpt (the matching LINE of the message) and matched_direction ('inbound' = the guest wrote it, 'outbound' = you did). Read matched_direction carefully: 'which guest complained about X' means inbound, 'what did we tell them about X' means outbound, and both match the same words. Compare match_score values to EACH OTHER rather than to a fixed bar. The excerpt is usually enough to answer directly; call read_conversation_thread when the full history matters. Without `search`, rows are sorted by most recent activity. Archived threads are always excluded. With no `status` filter it returns BOTH active and complete conversations (meta.status_filter records what ran); pass status:'active' to scope to the open working set.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      search: {
        type: 'string',
        minLength: 2,
        description:
          "Fuzzy, RANKED free-text search across guest MESSAGE BODIES, guest name, and property name. The only way to find a thread by what was said in it. Tolerates typos and partial words — pass the user's own wording rather than tidying it. Results carry matched_excerpt (the matching line) and matched_direction (inbound = guest, outbound = host).",
      },
      guest_name: {
        type: 'string',
        minLength: 2,
        description: 'Case-insensitive substring match on the guest name. Minimum 2 characters. Prefer `search` when the user is describing what was said rather than naming a guest.',
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
