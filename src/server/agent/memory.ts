import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { getSupabaseServer } from '@/lib/supabaseServer';

// Agent conversation memory — the single place that decides WHICH conversation
// a message belongs to and what gets replayed into the next turn.
//
// Before this module, two copy-pasted queries (one in app/api/agent/route.ts,
// one in app/api/slack/events/route.ts) both read `ai_chat_messages` by
// `user_id` alone, and eight scattered inserts wrote to it. Because neither read
// filtered by surface, Slack and the web panel shared one transcript: you could
// start something in Slack and finish it in the web chat as though it were one
// conversation. Sessions replace the user id as the conversation key.
//
// Keying, by surface (see the migration for the full rationale):
//   web           — one session per user today; Phase 2 adds create/switch/name.
//   slack DM      — one per (user, DM channel). Fixed; Slack affords no second
//                   conversation in a DM.
//   slack channel — one per THREAD, shared by everyone in it. The bot is joining
//                   a team conversation, not holding N private ones.
//
// Everything here runs on the service client and filters explicitly, matching
// how the agent routes already read and write. RLS on these tables is
// ORG-scoped, not user-scoped, so it is not a substitute for those filters.
//
// Fail-soft throughout: a memory failure degrades the reply (the agent forgets)
// rather than costing the user their answer. Callers get null/[] and carry on.

/**
 * How many message rows to replay into a turn, per surface.
 *
 * These differ on purpose. Every replayed row is re-sent at full price on every
 * turn, so the ceiling is a standing cost — and what makes it affordable is
 * having a way to shed it.
 *
 * Web has one: start a new session. So the cap is generous and mostly a
 * backstop for someone who never does.
 *
 * Slack matches it by decision rather than because it has the same escape
 * hatch. A channel thread sheds context organically — a new thread is a new
 * session — but a DM runs forever with no reset, so it carries all 200 rows
 * indefinitely. Two consequences worth knowing:
 *
 *   - Cost is bounded and mostly absorbed by prompt caching on consecutive
 *     turns, since the previous turn's cached prefix still matches.
 *   - Drift is NOT bounded. A DM will hold weeks of unrelated requests, and
 *     old assistant turns exert real pull on formatting (see
 *     stripTaskListMetadata in src/slack/format.ts, which exists precisely
 *     because replayed turns re-seed superseded output shapes).
 *
 * A per-DM reset would bound the second one. Until there is one, this is a
 * deliberate trade, not an oversight.
 */
export const WEB_HISTORY_LIMIT = 200;
export const SLACK_HISTORY_LIMIT = 200;

export type MemorySurface = 'web' | 'slack';

export type MemoryRole = 'user' | 'assistant';

interface ChatMessageRow {
  role: string;
  content: string;
  slack_message_ts: string | null;
}

export interface ReplayedHistory {
  messages: MessageParam[];
  /**
   * Slack ts of every message in `messages` that has one.
   *
   * The Slack thread reader subtracts this set from what it pulls, so a message
   * already replayed as a real conversation turn isn't ALSO pasted into the
   * ambient context block. Anything outside the set — an automation card, a
   * notification, an older turn that fell out of the replay window — is fair
   * game for the reader to supply. See src/slack/thread.ts.
   */
  seenMessageTs: Set<string>;
}

/**
 * Replay the tail of a session as plain-text turns.
 *
 * Only final text is persisted — no tool_use / tool_result blocks — so what
 * comes back is plain on both sides and the agent re-invokes tools as needed.
 * Returns [] for a missing session or any read failure: a turn with no memory
 * is worse than a turn with memory, but far better than no turn at all.
 */
export async function loadHistory(
  sessionId: string | null,
  limit: number,
): Promise<MessageParam[]> {
  return (await loadReplayedHistory(sessionId, limit)).messages;
}

/**
 * As `loadHistory`, plus the Slack ts of everything it replayed.
 *
 * One query for both so the two can never disagree — a ts missing from the set
 * while its message is in the history would duplicate that message in the
 * prompt, and the reverse would hide it.
 */
export async function loadReplayedHistory(
  sessionId: string | null,
  limit: number,
): Promise<ReplayedHistory> {
  const empty: ReplayedHistory = { messages: [], seenMessageTs: new Set() };
  if (!sessionId) return empty;

  const { data, error } = await getSupabaseServer()
    .from('ai_chat_messages')
    .select('role, content, slack_message_ts')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) {
    if (error) console.error('[agent memory] history read failed', { sessionId, error });
    return empty;
  }

  const rows = (data as ChatMessageRow[])
    .reverse()
    .filter((m) => m.role === 'user' || m.role === 'assistant');

  return {
    messages: rows.map((m) => ({
      role: m.role as MemoryRole,
      content: m.content,
    })),
    seenMessageTs: new Set(
      rows
        .map((m) => m.slack_message_ts)
        .filter((ts): ts is string => !!ts),
    ),
  };
}

export interface AppendMessageArgs {
  sessionId: string | null;
  appUserId: string;
  surface: MemorySurface;
  role: MemoryRole;
  content: string;
  /** Tool traces, mask flags, pending-action ids, Slack coordinates, etc. */
  metadata?: Record<string, unknown>;
  /**
   * The Slack message this turn IS, when known at insert time — which means
   * inbound user messages. The agent's own replies don't have a ts until
   * they're posted, so those call `setMessageSlackTs` afterwards with the id
   * returned here.
   */
  slackMessageTs?: string | null;
}

/**
 * Record one turn. Returns the new row's id, or null if the write failed.
 *
 * `user_id` is still written — it's who SAID this, which stays meaningful on a
 * shared Slack thread where the session has several participants. `session_id`
 * is what the next turn reads by.
 */
export async function appendMessage(
  args: AppendMessageArgs,
): Promise<string | null> {
  const { data, error } = await getSupabaseServer()
    .from('ai_chat_messages')
    .insert({
      session_id: args.sessionId,
      user_id: args.appUserId,
      surface: args.surface,
      role: args.role,
      content: args.content,
      slack_message_ts: args.slackMessageTs ?? null,
      ...(args.metadata && Object.keys(args.metadata).length > 0
        ? { metadata: args.metadata }
        : {}),
    })
    .select('id')
    .maybeSingle();

  if (error || !data?.id) {
    console.error('[agent memory] append failed', {
      sessionId: args.sessionId,
      surface: args.surface,
      role: args.role,
      error,
    });
    return null;
  }
  return data.id as string;
}

/**
 * Stamp a stored turn with the Slack message it was posted as.
 *
 * Split from the insert because the agent's reply is persisted BEFORE it is
 * posted — deliberately, so a Slack API failure costs the thread its message
 * but not its memory. Same shape as setPendingActionMessageTs, for the same
 * reason. Best-effort: without the stamp the reader may echo that message back
 * as ambient context, which is redundant but never wrong.
 */
export async function setMessageSlackTs(
  messageId: string | null,
  messageTs: string | undefined,
): Promise<void> {
  if (!messageId || !messageTs) return;
  const { error } = await getSupabaseServer()
    .from('ai_chat_messages')
    .update({ slack_message_ts: messageTs })
    .eq('id', messageId);
  if (error) {
    console.warn('[agent memory] message ts stamp failed', { messageId, error });
  }
}

export interface ResolveWebSessionArgs {
  appUserId: string;
  orgId: string | null;
  /**
   * An explicit session to continue. Verified against the caller before use — a
   * client-supplied id must never reach another user's conversation. Falls back
   * to the most recent session when absent or not theirs.
   *
   * Nothing sends this yet; Phase 2's session switcher will.
   */
  sessionId?: string | null;
}

/**
 * The web session to run this turn against, creating one if needed.
 *
 * With no session UI yet, "most recent live session" reproduces exactly what the
 * user has today: one continuous web conversation. Phase 2 changes only which id
 * arrives here, not this function's contract.
 */
export async function resolveWebSession(
  args: ResolveWebSessionArgs,
): Promise<string | null> {
  const supabase = getSupabaseServer();

  if (args.sessionId) {
    const { data } = await supabase
      .from('agent_sessions')
      .select('id')
      .eq('id', args.sessionId)
      .eq('surface', 'web')
      .eq('owner_user_id', args.appUserId)
      .is('archived_at', null)
      .maybeSingle();
    if (data?.id) return data.id as string;
    // Wrong owner, archived, or gone. Fall through to the most recent rather
    // than failing the turn — but never silently honour the id.
    console.warn('[agent memory] web session id not usable; falling back', {
      sessionId: args.sessionId,
      appUserId: args.appUserId,
    });
  }

  const { data: existing, error } = await supabase
    .from('agent_sessions')
    .select('id')
    .eq('surface', 'web')
    .eq('owner_user_id', args.appUserId)
    .is('archived_at', null)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[agent memory] web session lookup failed', { error });
    return null;
  }
  if (existing?.id) return existing.id as string;

  return insertSession({
    orgId: args.orgId,
    ownerUserId: args.appUserId,
    surface: 'web',
  });
}

export interface ResolveSlackSessionArgs {
  appUserId: string;
  orgId: string | null;
  channelId: string;
  /**
   * Thread root for a channel mention; undefined for a DM. This is the same
   * value the events route already computes for threading its reply
   * (`event.thread_ts ?? event.ts`, or undefined in a DM), so the session
   * boundary and the visible Slack thread are the same boundary.
   */
  threadTs?: string | null;
}

/**
 * The Slack session for a channel thread or DM, creating one if needed.
 *
 * Keyed on the conversation, NOT the person: everyone in a thread shares one
 * memory, because they're all talking to the bot about the same thing. The
 * caller's identity still lands on each message row.
 */
export async function resolveSlackSession(
  args: ResolveSlackSessionArgs,
): Promise<string | null> {
  const supabase = getSupabaseServer();
  const threadTs = args.threadTs ?? null;

  const find = async () => {
    let query = supabase
      .from('agent_sessions')
      .select('id')
      .eq('surface', 'slack')
      .eq('slack_channel_id', args.channelId)
      .is('archived_at', null);
    query = threadTs
      ? query.eq('slack_thread_ts', threadTs)
      : query.is('slack_thread_ts', null);
    const { data, error } = await query.maybeSingle();
    if (error) {
      console.error('[agent memory] slack session lookup failed', {
        channelId: args.channelId,
        threadTs,
        error,
      });
      return null;
    }
    return (data?.id as string | undefined) ?? null;
  };

  const existing = await find();
  if (existing) return existing;

  const created = await insertSession({
    orgId: args.orgId,
    ownerUserId: args.appUserId,
    surface: 'slack',
    slackChannelId: args.channelId,
    slackThreadTs: threadTs,
  });
  if (created) return created;

  // Two events in the same thread can race here (Slack delivers concurrently,
  // and both handlers run in `after()`). The partial unique index makes the
  // loser's insert fail rather than fork the thread's memory in two; re-reading
  // hands it the winner's session.
  return find();
}

async function insertSession(args: {
  orgId: string | null;
  ownerUserId: string;
  surface: MemorySurface;
  slackChannelId?: string;
  slackThreadTs?: string | null;
}): Promise<string | null> {
  const { data, error } = await getSupabaseServer()
    .from('agent_sessions')
    .insert({
      // Null lets the derive_org_id trigger fill it from the owner. Explicit
      // wins, and every caller in the tree has a real org today.
      org_id: args.orgId ?? null,
      owner_user_id: args.ownerUserId,
      surface: args.surface,
      slack_channel_id: args.slackChannelId ?? null,
      slack_thread_ts: args.slackThreadTs ?? null,
    })
    .select('id')
    .maybeSingle();

  if (error || !data?.id) {
    console.error('[agent memory] session create failed', {
      surface: args.surface,
      error,
    });
    return null;
  }
  return data.id as string;
}
