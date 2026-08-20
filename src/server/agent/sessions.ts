import { getSupabaseServer } from '@/lib/supabaseServer';
import {
  loadProposedTaskCards,
  type AgentProposedTaskCard,
} from './proposedTaskCards';

// Web chat sessions — list, rename, archive, and rehydrate.
//
// Everything here runs on the SERVICE client with an explicit
// `owner_user_id` filter, and that is load-bearing rather than incidental:
// RLS on agent_sessions / ai_chat_messages is ORG-scoped (see
// 20260702130000_multi_tenant_p1_rls.sql), so a session-client read would
// happily return an org peer's conversations. The filter here is the only
// thing making these endpoints per-user. Do not "simplify" this onto the
// user's Supabase client.
//
// Slack sessions are deliberately invisible to all of it. A Slack thread or DM
// is machinery — it has no name, nobody browses it, and archiving one would
// just make the bot forget mid-thread. Every query pins surface='web'.

/** Ceiling on a rehydrated transcript. */
const MAX_HYDRATED_MESSAGES = 500;

/** Longest auto-derived title before it gets an ellipsis. */
const MAX_TITLE_LENGTH = 60;

export interface SessionSummary {
  id: string;
  title: string | null;
  created_at: string;
  last_message_at: string | null;
}

export interface HydratedMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: { id: string; name: string }[];
  /** Present only when those actions are STILL pending — see loadSessionMessages. */
  pending_action_ids?: string[];
  /**
   * Task proposal cards registered by this message (propose_task). Unlike
   * pending actions these persist across every lifecycle state — accepted and
   * dismissed proposals rehydrate as tombstones, matching the concierge inbox.
   */
  proposed_tasks?: AgentProposedTaskCard[];
  variant?: 'success' | 'error';
}

const SUMMARY_COLUMNS = 'id, title, created_at, last_message_at';

interface MessageRow {
  id: string;
  role: string;
  content: string;
  metadata: Record<string, unknown> | null;
}

/**
 * A session's live conversations, newest activity first.
 *
 * Archived sessions are excluded rather than deleted — the per-message
 * `metadata.tool_calls` trace is what we use to diagnose hallucinated writes
 * after the fact, and a delete would take it with it.
 */
export async function listWebSessions(
  appUserId: string,
): Promise<SessionSummary[]> {
  const { data, error } = await getSupabaseServer()
    .from('agent_sessions')
    .select(SUMMARY_COLUMNS)
    .eq('surface', 'web')
    .eq('owner_user_id', appUserId)
    .is('archived_at', null)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error('[agent sessions] list failed', { error });
    return [];
  }
  return (data ?? []) as SessionSummary[];
}

/**
 * Rename a session. Returns false when it isn't the caller's, which is the
 * same answer as "doesn't exist" — deliberately, so probing ids tells you
 * nothing.
 */
export async function renameWebSession(
  appUserId: string,
  sessionId: string,
  title: string,
): Promise<boolean> {
  const trimmed = title.trim().slice(0, 200);
  const { data, error } = await getSupabaseServer()
    .from('agent_sessions')
    .update({ title: trimmed || null, updated_at: new Date().toISOString() })
    .eq('id', sessionId)
    .eq('surface', 'web')
    .eq('owner_user_id', appUserId)
    .is('archived_at', null)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[agent sessions] rename failed', { sessionId, error });
    return false;
  }
  return !!data?.id;
}

/** Soft-delete. The messages stay; the session stops being listed or resolved. */
export async function archiveWebSession(
  appUserId: string,
  sessionId: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  const { data, error } = await getSupabaseServer()
    .from('agent_sessions')
    .update({ archived_at: now, updated_at: now })
    .eq('id', sessionId)
    .eq('surface', 'web')
    .eq('owner_user_id', appUserId)
    .is('archived_at', null)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[agent sessions] archive failed', { sessionId, error });
    return false;
  }
  return !!data?.id;
}

/**
 * Rebuild a session's transcript for the chat panel.
 *
 * Two things deliberately do NOT survive a reload:
 *
 *   - Task cards. `find_tasks` rows aren't persisted (the stored trace keeps
 *     each call's `meta` but drops `data`, to keep rows small), so a reloaded
 *     answer keeps its markdown task links but loses the cards under it.
 *   - Resolved Confirm/Cancel pairs. Buttons come back ONLY for actions still
 *     pending and unexpired, so refreshing mid-preview keeps the click alive
 *     while an old committed turn doesn't offer to commit itself again.
 */
export async function loadSessionMessages(
  appUserId: string,
  sessionId: string,
): Promise<HydratedMessage[] | null> {
  const supabase = getSupabaseServer();

  // Ownership first — the id came from the client.
  const { data: session } = await supabase
    .from('agent_sessions')
    .select('id')
    .eq('id', sessionId)
    .eq('surface', 'web')
    .eq('owner_user_id', appUserId)
    .is('archived_at', null)
    .maybeSingle();
  if (!session?.id) return null;

  const { data, error } = await supabase
    .from('ai_chat_messages')
    .select('id, role, content, metadata')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
    .limit(MAX_HYDRATED_MESSAGES);

  if (error) {
    console.error('[agent sessions] message load failed', { sessionId, error });
    return null;
  }

  const rows = (data ?? []) as MessageRow[];

  // One query for every action id mentioned anywhere in the transcript; the
  // survivors are the ones that still deserve buttons.
  const referencedIds = new Set<string>();
  const referencedProposalIds = new Set<string>();
  for (const row of rows) {
    for (const id of readActionIds(row.metadata)) referencedIds.add(id);
    for (const id of readProposedTaskIds(row.metadata)) {
      referencedProposalIds.add(id);
    }
  }
  const liveIds = await loadLivePendingActionIds(Array.from(referencedIds));

  // Proposal cards for the whole transcript in one query. Dismissed rows
  // (including superseded ones) are dropped — matching the concierge inbox,
  // which renders pending cards and accepted tombstones only.
  const proposalCards = new Map(
    (await loadProposedTaskCards(supabase, Array.from(referencedProposalIds)))
      .filter((c) => c.status !== 'dismissed')
      .map((c) => [c.id, c]),
  );

  const out: HydratedMessage[] = [];
  for (const row of rows) {
    if (row.role !== 'user' && row.role !== 'assistant') continue;
    const meta = row.metadata ?? {};

    // The synthetic "Confirmed." / "Cancelled." turn exists so the next agent
    // turn knows what the user did. Live, the click never rendered as a
    // message — it turned the buttons into a result — so replaying it as a
    // user bubble would show them something they never saw.
    if (row.role === 'user' && meta.kind === 'confirmation_click') continue;

    const message: HydratedMessage = {
      id: row.id,
      role: row.role,
      content: row.content,
    };

    const attachments = readAttachments(meta);
    if (attachments) message.attachments = attachments;

    const stillPending = readActionIds(meta).filter((id) => liveIds.has(id));
    if (stillPending.length > 0 && row.role === 'assistant') {
      message.pending_action_ids = stillPending;
    }

    if (row.role === 'assistant') {
      const proposals = readProposedTaskIds(meta)
        .map((id) => proposalCards.get(id))
        .filter((c): c is AgentProposedTaskCard => c !== undefined);
      if (proposals.length > 0) message.proposed_tasks = proposals;
    }

    const variant = readVariant(meta);
    if (variant) message.variant = variant;

    out.push(message);
  }
  return out;
}

/**
 * Name a session after the message that started it, if it has no name yet.
 *
 * Single conditional statement — `title is null` means the first message wins
 * and later ones don't churn it, and a name the user typed themselves is never
 * overwritten.
 */
export async function maybeTitleSession(
  sessionId: string | null,
  prompt: string,
): Promise<void> {
  if (!sessionId) return;
  const title = deriveSessionTitle(prompt);
  if (!title) return;

  const { error } = await getSupabaseServer()
    .from('agent_sessions')
    .update({ title })
    .eq('id', sessionId)
    .is('title', null);
  if (error) {
    console.warn('[agent sessions] auto-title failed', { sessionId, error });
  }
}

/** First line, collapsed and clipped. Deterministic — no model call for a label. */
export function deriveSessionTitle(prompt: string): string {
  const firstLine = prompt.trim().split('\n')[0] ?? '';
  const cleaned = firstLine.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  return cleaned.length > MAX_TITLE_LENGTH
    ? `${cleaned.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`
    : cleaned;
}

async function loadLivePendingActionIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await getSupabaseServer()
    .from('agent_pending_actions')
    .select('id')
    .in('id', ids)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString());

  if (error) {
    // Fail closed: no buttons is a recoverable annoyance (ask again); buttons
    // for an action that already committed would double-write.
    console.error('[agent sessions] pending action probe failed', { error });
    return new Set();
  }
  return new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
}

function readActionIds(meta: Record<string, unknown> | null): string[] {
  const raw = meta?.pending_action_ids;
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

function readProposedTaskIds(meta: Record<string, unknown> | null): string[] {
  const raw = meta?.proposed_task_ids;
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

function readAttachments(
  meta: Record<string, unknown>,
): { id: string; name: string }[] | null {
  const raw = meta.inbound_files;
  if (!Array.isArray(raw)) return null;
  const files = raw
    .filter((f): f is { id: string; name: string } => {
      if (!f || typeof f !== 'object') return false;
      const rec = f as Record<string, unknown>;
      return typeof rec.id === 'string' && typeof rec.name === 'string';
    })
    .map((f) => ({ id: f.id, name: f.name }));
  return files.length > 0 ? files : null;
}

/**
 * Colour a committed/cancelled outcome the way the live client does — green
 * means the write landed, matching --task-green in the task panel.
 */
function readVariant(
  meta: Record<string, unknown>,
): 'success' | 'error' | undefined {
  const raw = meta.pending_action_results;
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const allOk = raw.every(
    (r) => !!r && typeof r === 'object' && (r as { ok?: unknown }).ok === true,
  );
  return allOk ? 'success' : 'error';
}
