import { getSupabaseServer } from '@/lib/supabaseServer';
import { getLatestSentMessage } from './latestMessage';
import { sendGuestMessage } from './sendGuestMessage';

// Auto-send: the timer between "the Concierge drafted a reply" and "the guest
// receives it", and the record of every timer's fate.
//
// Shape of the feature:
//   ARM    — a genuinely new guest message arrives, the gated autonomous path
//            writes a draft, and (only if the org opted in) we write a `pending`
//            row due `delay_minutes` from now.
//   CANCEL — anything that means a human has taken the thread, or that the draft
//            no longer answers the current state, resolves the row without
//            sending. Cancels are recorded, never deleted.
//   TICK   — a cron claims due rows one at a time, RE-VALIDATES from scratch,
//            and sends.
//
// Two invariants worth stating plainly, because the whole design hangs off them:
//
// 1. OFF BY DEFAULT, ALWAYS. Every read of the org switch degrades to disabled —
//    a missing column, an absent row, a thrown query. The other concierge flags
//    deliberately do the opposite (a missing column reads as enabled) because
//    failing open on DRAFTING is harmless. Failing open on SENDING is not.
//
// 2. ARMING IS FORWARD-ONLY. Only the webhook path arms, so a timer exists only
//    because a guest just spoke — never because an operator opened an old thread,
//    and never retroactively for drafts already sitting in the inbox. Turning the
//    switch on must not fire a backlog of replies into threads idle for days.
//    `auto_send_enabled_at` enforces this explicitly rather than leaving it as an
//    emergent property of who happens to call armAutoSend().

/** Why a pending row stopped being pending. Recorded on the row. */
export type AutoSendCancelReason =
  | 'human_sent' // a person answered the thread themselves
  | 'edited' // a person pulled the draft into the composer — they have the wheel
  | 'operator_cancelled' // a person hit Cancel on the countdown
  | 'regenerated' // a fresh draft superseded this one (the new one re-arms)
  | 'new_guest_message' // the guest spoke again; the draft answers a stale turn
  | 'concierge_disabled' // per-conversation kill switch flipped off
  | 'conversation_inactive' // completed or archived
  | 'auto_send_disabled' // the org switch went off before this fired
  | 'draft_cleared' // the stored draft is gone or no longer matches
  | 'stale_draft'; // re-validation at fire time found a newer message

export interface AutoSendSettings {
  enabled: boolean;
  delayMinutes: number;
  enabledAt: string | null;
}

const DISABLED: AutoSendSettings = { enabled: false, delayMinutes: 10, enabledAt: null };

/** Lowest configurable delay, in minutes. Mirrored in the settings UI and API. */
export const MIN_AUTO_SEND_DELAY_MINUTES = 1;
export const MAX_AUTO_SEND_DELAY_MINUTES = 1440;
export const DEFAULT_AUTO_SEND_DELAY_MINUTES = 10;

/**
 * How many rows one tick will send. A burst cap, not a rate limit: it exists so
 * that a webhook replay, a bad ingest, or a switch flipped on against an
 * unexpected backlog cannot turn into fifty messages to guests in one minute.
 * Rows over the cap stay pending and fire on the next tick.
 */
const MAX_SENDS_PER_TICK = 25;

/**
 * Org auto-send settings. Degrades to DISABLED on anything unexpected — see
 * invariant 1 above.
 */
export async function loadAutoSendSettings(orgId: string | null): Promise<AutoSendSettings> {
  if (!orgId) return DISABLED;
  try {
    const { data, error } = await getSupabaseServer()
      .from('operations_settings')
      .select('auto_send_enabled, auto_send_delay_minutes, auto_send_enabled_at')
      .eq('org_id', orgId)
      .maybeSingle();
    if (error || !data) return DISABLED;
    const row = data as {
      auto_send_enabled?: unknown;
      auto_send_delay_minutes?: unknown;
      auto_send_enabled_at?: unknown;
    };
    // Only an explicit `true` enables. Anything else — null, undefined, a string,
    // a column that isn't there yet — is off.
    if (row.auto_send_enabled !== true) return DISABLED;
    const raw = row.auto_send_delay_minutes;
    const minutes = typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : NaN;
    return {
      enabled: true,
      delayMinutes: Number.isFinite(minutes)
        ? Math.min(MAX_AUTO_SEND_DELAY_MINUTES, Math.max(MIN_AUTO_SEND_DELAY_MINUTES, minutes))
        : DEFAULT_AUTO_SEND_DELAY_MINUTES,
      enabledAt: typeof row.auto_send_enabled_at === 'string' ? row.auto_send_enabled_at : null,
    };
  } catch {
    // Column/table missing in an older environment, or the query blew up. Off.
    return DISABLED;
  }
}

/**
 * Arm a timer for a freshly written autonomous draft. No-op unless the org has
 * auto-send on. Never throws — a bookkeeping failure must not fail the draft
 * that was already successfully written.
 *
 * Called ONLY from the webhook autonomous path (see invariant 2).
 */
export async function armAutoSend(params: {
  conversationId: string;
  orgId: string | null;
  draft: string;
  answersMessageId: string | null;
}): Promise<void> {
  const { conversationId, orgId, draft, answersMessageId } = params;
  try {
    const settings = await loadAutoSendSettings(orgId);
    if (!settings.enabled) return;
    if (!draft.trim()) return;

    // Forward-only. A draft may only arm if the switch was already on when it was
    // generated — which is now, so this compares against the moment the operator
    // enabled the feature. Belt and braces alongside "only the webhook arms".
    if (settings.enabledAt && Date.now() < new Date(settings.enabledAt).getTime()) return;

    const supabase = getSupabaseServer();

    // One armed timer per conversation (enforced by a partial unique index).
    // A new draft supersedes any older pending row rather than racing it.
    await cancelAutoSend(conversationId, 'regenerated');

    const dueAt = new Date(Date.now() + settings.delayMinutes * 60_000).toISOString();
    const { error } = await supabase.from('concierge_auto_sends').insert({
      org_id: orgId,
      conversation_id: conversationId,
      draft_text: draft,
      answers_message_id: answersMessageId,
      status: 'pending',
      due_at: dueAt,
    });
    if (error) {
      console.error('[auto-send] arm failed', { conversationId, error: error.message });
    }
  } catch (err) {
    console.error('[auto-send] arm threw', { conversationId, err });
  }
}

/**
 * Resolve any armed timer on a conversation without sending. Idempotent — a
 * conversation with nothing pending is a no-op, which is why every caller can
 * fire it defensively.
 */
export async function cancelAutoSend(
  conversationId: string,
  reason: AutoSendCancelReason,
  cancelledBy?: string | null,
): Promise<void> {
  const { error } = await getSupabaseServer()
    .from('concierge_auto_sends')
    .update({
      status: 'cancelled',
      reason,
      cancelled_by: cancelledBy ?? null,
      resolved_at: new Date().toISOString(),
    })
    .eq('conversation_id', conversationId)
    .eq('status', 'pending');
  if (error) {
    console.error('[auto-send] cancel failed', { conversationId, reason, error: error.message });
  }
}

export interface AutoSendTickOutcome {
  id: string;
  conversation_id: string;
  status: 'sent' | 'cancelled' | 'failed' | 'skipped';
  reason?: string;
}

interface PendingRow {
  id: string;
  org_id: string | null;
  conversation_id: string;
  draft_text: string;
  answers_message_id: string | null;
}

/**
 * Fire every auto-send that has come due.
 *
 * Re-validates each row from scratch immediately before sending rather than
 * trusting that it is still pending. A cancel can be missed — a browser tab that
 * never fired its request, a crashed handler, a switch flipped in another
 * session — and the cost of a wrong send is a message a guest actually reads.
 * The checks are cheap; the mistake is not.
 */
export async function runAutoSendTick(now: Date = new Date()): Promise<AutoSendTickOutcome[]> {
  const supabase = getSupabaseServer();

  const { data, error } = await supabase
    .from('concierge_auto_sends')
    .select('id, org_id, conversation_id, draft_text, answers_message_id')
    .eq('status', 'pending')
    .lte('due_at', now.toISOString())
    .order('due_at', { ascending: true })
    .limit(MAX_SENDS_PER_TICK);
  if (error) throw new Error(error.message);

  const due = (data ?? []) as PendingRow[];
  const outcomes: AutoSendTickOutcome[] = [];

  for (const row of due) {
    try {
      outcomes.push(await processDueRow(supabase, row));
    } catch (err) {
      console.error('[auto-send] tick row threw', { id: row.id, err });
      await resolve(supabase, row.id, 'failed', err instanceof Error ? err.message : 'unknown');
      outcomes.push({
        id: row.id,
        conversation_id: row.conversation_id,
        status: 'failed',
        reason: 'exception',
      });
    }
  }

  return outcomes;
}

type ServiceClient = ReturnType<typeof getSupabaseServer>;

async function resolve(
  supabase: ServiceClient,
  id: string,
  status: 'sent' | 'cancelled' | 'failed' | 'skipped',
  reason: string | null,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await supabase
    .from('concierge_auto_sends')
    .update({ status, reason, resolved_at: new Date().toISOString(), ...extra })
    .eq('id', id);
  if (error) console.error('[auto-send] resolve failed', { id, status, error: error.message });
}

async function processDueRow(
  supabase: ServiceClient,
  row: PendingRow,
): Promise<AutoSendTickOutcome> {
  const cancelled = (reason: AutoSendCancelReason): AutoSendTickOutcome => ({
    id: row.id,
    conversation_id: row.conversation_id,
    status: 'cancelled',
    reason,
  });

  // ---- Re-validation, cheapest and most decisive checks first ----------------

  // The org switch may have been turned off during the delay window.
  const settings = await loadAutoSendSettings(row.org_id);
  if (!settings.enabled) {
    await resolve(supabase, row.id, 'cancelled', 'auto_send_disabled');
    return cancelled('auto_send_disabled');
  }

  const { data: conv, error: convErr } = await supabase
    .from('conversations')
    .select('id, app_status, archived, concierge_enabled, proposed_reply, proposed_reply_answers_message_id')
    .eq('id', row.conversation_id)
    .maybeSingle();
  if (convErr) throw new Error(convErr.message);
  if (!conv) {
    await resolve(supabase, row.id, 'cancelled', 'conversation_inactive');
    return cancelled('conversation_inactive');
  }
  const c = conv as {
    app_status: 'active' | 'complete';
    archived: boolean;
    concierge_enabled: boolean;
    proposed_reply: string | null;
    proposed_reply_answers_message_id: string | null;
  };

  if (c.archived || c.app_status !== 'active') {
    await resolve(supabase, row.id, 'cancelled', 'conversation_inactive');
    return cancelled('conversation_inactive');
  }
  if (c.concierge_enabled === false) {
    await resolve(supabase, row.id, 'cancelled', 'concierge_disabled');
    return cancelled('concierge_disabled');
  }

  // The draft must still be the one on the conversation. If an operator edited,
  // cleared, or replaced it, what we hold is not what the inbox has been showing
  // — and the inbox is what a human would have been reviewing.
  if (!c.proposed_reply || c.proposed_reply !== row.draft_text) {
    await resolve(supabase, row.id, 'cancelled', 'draft_cleared');
    return cancelled('draft_cleared');
  }

  // Nothing newer may have landed. A newer message means either the guest spoke
  // again (the draft answers a superseded turn) or a human already replied.
  const latest = await getLatestSentMessage(row.conversation_id);
  if (!latest || latest.id !== row.answers_message_id) {
    await resolve(supabase, row.id, 'cancelled', 'stale_draft');
    return cancelled('stale_draft');
  }

  // ---- Claim, then send -----------------------------------------------------

  // Atomic claim: only the tick that flips pending → sending proceeds, so two
  // overlapping cron runs cannot both send this row.
  const { data: claimed, error: claimErr } = await supabase
    .from('concierge_auto_sends')
    .update({ status: 'sending' })
    .eq('id', row.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  if (claimErr) throw new Error(claimErr.message);
  if (!claimed) {
    return { id: row.id, conversation_id: row.conversation_id, status: 'skipped', reason: 'claimed_elsewhere' };
  }

  const result = await sendGuestMessage({
    conversationId: row.conversation_id,
    text: row.draft_text,
    actor: { type: 'auto' },
  });

  if (!result.ok) {
    await resolve(supabase, row.id, 'failed', result.code);
    return { id: row.id, conversation_id: row.conversation_id, status: 'failed', reason: result.code };
  }

  await resolve(supabase, row.id, 'sent', null, { sent_message_id: result.messageId });

  // The draft has now been delivered; clear it so the inbox stops offering it.
  const { error: clearErr } = await supabase
    .from('conversations')
    .update({
      proposed_reply: null,
      proposed_reply_answers_message_id: null,
      proposed_reply_source: null,
      proposed_reply_generated_at: null,
      proposed_reply_sources: null,
    })
    .eq('id', row.conversation_id);
  if (clearErr) console.error('[auto-send] draft clear failed', { id: row.id, error: clearErr.message });

  return { id: row.id, conversation_id: row.conversation_id, status: 'sent' };
}
