import { getSupabaseServer } from '@/lib/supabaseServer';
import { generateGuestReplyDraft } from './draftReply';
import { CONCIERGE_SOURCES_VERSION, type ConciergeSource } from './conciergeSources';
import { loadConciergeProposalFlags, loadReplyProposalSensitivity } from './conciergeCapabilities';
import { notifyProposedReply } from '@/src/server/notifications/notifyProposal';

// Persisted proposed replies. The Concierge drafts a reply ONCE and we store it
// on the conversation; the inbox reads it instead of regenerating on every open.
//
// Generation splits on ONE question: did a human ask for this draft?
//
//   AUTONOMOUS — nobody asked. We're drafting because a message arrived, or
//   because a thread was opened with nothing drafted yet. Both go through
//   maybeGenerateProposedReplyForConversation, which applies the full policy:
//   the org master switch, active/unarchived, guest-is-awaiting-a-reply,
//   not-already-decided, and the reply-warrant sensitivity gate.
//     - the webhook, when a new guest message arrives    → source 'auto', notify
//     - the inbox, on open, when nothing is drafted yet  → source 'auto'
//
//   MANUAL — a human clicked ↻ Regenerate or the composer's Sparkles, or told
//   the ops agent to draft. Calls generateAndStoreProposedReply directly and is
//   deliberately UNGATED: an explicit ask always produces a draft.
//     - the inbox's ↻ / Sparkles buttons                 → source 'auto'
//     - the ops agent's `concierge` tool                 → source 'assistant'
//
// The distinction matters because the master switch and the gate exist to stop
// the Concierge from drafting UNPROMPTED. Opening a thread is not a prompt.
//
// `answers_message_id` is the latest sent message the draft was written against,
// so the inbox can tell when a newer guest message has made the draft stale.
// `declined_message_id` is its counterpart for the gate's "no" — see the
// 20260716120000 migration for why a decline never clears the stored draft.

export type ProposedReplySource = 'auto' | 'assistant';

interface LatestSent {
  id: string;
  direction: 'inbound' | 'outbound';
}

/** The latest actually-sent message in a conversation (future-dated automations excluded). */
export async function getLatestSentMessage(conversationId: string): Promise<LatestSent | null> {
  const nowIso = new Date().toISOString();
  const { data, error } = await getSupabaseServer()
    .from('guest_messages')
    .select('id, direction, sent_at')
    .eq('conversation_id', conversationId)
    .or(`sent_at.is.null,sent_at.lte.${nowIso}`)
    .order('sent_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const row = (data ?? [])[0] as { id: string; direction: 'inbound' | 'outbound' } | undefined;
  return row ? { id: row.id, direction: row.direction } : null;
}

export interface StoredProposedReply {
  draft: string;
  answers_message_id: string | null;
  /** What grounded the draft (training + tool calls), for the inbox's source chips. */
  sources: ConciergeSource[];
  /** True when the sensitivity gate decided no reply was warranted (nothing stored). */
  skipped?: boolean;
}

/**
 * Generate a Concierge draft for a conversation and PERSIST it on the row.
 * Returns the draft. Throws on generation/DB errors (callers map to their shape).
 */
export async function generateAndStoreProposedReply(
  conversationId: string,
  opts: {
    source: ProposedReplySource;
    instruction?: string;
    /**
     * Emit a `proposed_reply` notification to opted-in users. Only the eager
     * (webhook) path sets this — a manual in-app "Regenerate" shouldn't ping
     * everyone. Only fires when the draft answers a fresh inbound message.
     */
    notify?: boolean;
    /**
     * Apply the reply-warrant sensitivity gate. Only the autonomous (webhook)
     * path sets this; manual "Regenerate" and the ops-agent tool always draft.
     */
    gate?: boolean;
  },
): Promise<StoredProposedReply> {
  const supabase = getSupabaseServer();
  const latest = await getLatestSentMessage(conversationId);

  // On the autonomous path, gate drafting by THIS conversation's org's
  // reply-sensitivity level (operations_settings is per-org).
  let replySensitivity: number | undefined;
  if (opts.gate) {
    const { data: orgRow } = await supabase
      .from('conversations')
      .select('org_id')
      .eq('id', conversationId)
      .maybeSingle();
    replySensitivity = await loadReplyProposalSensitivity(
      ((orgRow as { org_id?: string | null } | null)?.org_id as string | null) ?? null,
    );
  }
  const { draft, warranted, sources } = await generateGuestReplyDraft({
    conversationId,
    instruction: opts.instruction,
    replySensitivity,
  });

  // The guest's turn didn't clear the sensitivity bar. Two things happen here:
  //
  // 1. Record the DECISION, so the inbox doesn't read "no draft" as "never
  //    drafted" and ask us again (burning a model call) on every open.
  // 2. CLEAR any older draft. A newer guest message always supersedes the last
  //    draft — it never lingers as "stale". There's no send path, so the host
  //    answers in the PMS; by the time the guest speaks again he has almost
  //    always already handled it (measured: 12 of 13 stale drafts had a host
  //    reply after the message they answered — one had six). The gate judges the
  //    turn since that reply, so a decline here means the outstanding work is
  //    genuinely done and the old draft answers a resolved question. Leaving it
  //    on screen invites sending a reply the guest has moved past.
  if (!warranted) {
    if (latest) {
      const { error } = await supabase
        .from('conversations')
        .update({
          proposed_reply: null,
          proposed_reply_answers_message_id: null,
          proposed_reply_source: null,
          proposed_reply_generated_at: null,
          // Clears with the draft it described — a sources record left behind
          // would explain the grounding of a draft that no longer exists.
          proposed_reply_sources: null,
          proposed_reply_declined_message_id: latest.id,
        })
        .eq('id', conversationId);
      if (error) throw new Error(error.message);
    }
    return { draft: '', answers_message_id: latest?.id ?? null, sources: [], skipped: true };
  }

  const { error } = await supabase
    .from('conversations')
    .update({
      proposed_reply: draft,
      proposed_reply_answers_message_id: latest?.id ?? null,
      proposed_reply_source: opts.source,
      proposed_reply_generated_at: new Date().toISOString(),
      // Written with the draft, always. An empty `sources` array is meaningful
      // (nothing grounded this reply) and must not be confused with the null a
      // pre-feature draft carries — the inbox renders the two differently.
      proposed_reply_sources: { version: CONCIERGE_SOURCES_VERSION, sources },
      // A draft supersedes any earlier "no" — e.g. a human hit ↻ to override the
      // gate. Leaving it set would make the next autonomous pass skip as
      // already-decided when there's now a real draft answering that message.
      proposed_reply_declined_message_id: null,
    })
    .eq('id', conversationId);
  if (error) throw new Error(error.message);

  // Notify only on the eager path, and only when we're actually answering a
  // guest (inbound) message — not a host follow-up nudge.
  if (opts.notify && latest?.direction === 'inbound') {
    try {
      const { data: conv } = await supabase
        .from('conversations')
        .select('property_id, property_name, guest_name')
        .eq('id', conversationId)
        .maybeSingle();
      const c = (conv ?? {}) as {
        property_id?: string | null;
        property_name?: string | null;
        guest_name?: string | null;
      };
      await notifyProposedReply({
        conversationId,
        propertyId: c.property_id ?? null,
        answersMessageId: latest.id,
        propertyName: c.property_name ?? null,
        guestName: c.guest_name ?? null,
      });
    } catch (err) {
      // Notification is best-effort; never fail the draft on it.
      console.error('[proposed reply] notify failed', { conversationId, err });
    }
  }

  return { draft, answers_message_id: latest?.id ?? null, sources };
}

/** Why an autonomous draft didn't happen. Surfaced to the inbox so it can tell
 *  "the Concierge declined" apart from "the Concierge is broken". */
export type AutoDraftSkipReason =
  | 'not_found'
  | 'inactive' // archived, or the thread is marked complete
  | 'disabled' // the org's autonomous reply-drafting master switch is off
  | 'no_inbound' // the host sent last — nobody is awaiting a reply
  | 'already_decided' // drafted OR gate-declined for this exact message
  | 'not_warranted'; // the gate just ruled this message doesn't need a reply

export type AutoDraftOutcome =
  | {
      status: 'generated';
      draft: string;
      answers_message_id: string | null;
      sources: ConciergeSource[];
    }
  | { status: 'skipped'; reason: AutoDraftSkipReason };

/**
 * The AUTONOMOUS draft path: draft a reply for a conversation only if the org's
 * policy says an unprompted draft is wanted here. Shared by both callers where
 * no human asked for a draft — the webhook (a guest message arrived) and the
 * inbox (a thread was opened with nothing drafted yet) — so they cannot drift.
 *
 * Throws on generation/DB errors; callers map to their own shape.
 */
export async function maybeGenerateProposedReplyForConversation(
  conversationId: string,
  opts: { notify?: boolean } = {},
): Promise<AutoDraftOutcome> {
  const supabase = getSupabaseServer();
  const { data: conv, error: convError } = await supabase
    .from('conversations')
    .select(
      'id, org_id, app_status, archived, proposed_reply_answers_message_id, proposed_reply_declined_message_id',
    )
    .eq('id', conversationId)
    .maybeSingle();
  // Surface read failures rather than letting them read as "no such conversation"
  // — a skip is a DECISION, and a broken query must never impersonate one.
  if (convError) throw new Error(convError.message);
  if (!conv) return { status: 'skipped', reason: 'not_found' };
  const c = conv as {
    id: string;
    org_id: string | null;
    app_status: 'active' | 'complete';
    archived: boolean;
    proposed_reply_answers_message_id: string | null;
    proposed_reply_declined_message_id: string | null;
  };
  if (c.archived || c.app_status !== 'active') return { status: 'skipped', reason: 'inactive' };

  // Master switch (per THIS conversation's org): when autonomous reply drafting
  // is off, nothing unprompted gets drafted — on either autonomous path. Manual
  // ↻ / Sparkles and the ops-agent tool call generateAndStoreProposedReply
  // directly and stay unaffected.
  if (!(await loadConciergeProposalFlags(c.org_id)).reply) {
    return { status: 'skipped', reason: 'disabled' };
  }

  const latest = await getLatestSentMessage(c.id);
  // Only draft when the guest is the one awaiting a reply.
  if (!latest || latest.direction !== 'inbound') return { status: 'skipped', reason: 'no_inbound' };
  // Already ruled on this exact message — either a draft answers it, or the gate
  // declined it. Both are decisions; neither should be re-derived.
  if (
    c.proposed_reply_answers_message_id === latest.id ||
    c.proposed_reply_declined_message_id === latest.id
  ) {
    return { status: 'skipped', reason: 'already_decided' };
  }

  const res = await generateAndStoreProposedReply(c.id, {
    source: 'auto',
    notify: opts.notify,
    gate: true,
  });
  if (res.skipped) return { status: 'skipped', reason: 'not_warranted' };
  return {
    status: 'generated',
    draft: res.draft,
    answers_message_id: res.answers_message_id,
    sources: res.sources,
  };
}

/**
 * Eager hook for the webhook: resolve the canonical conversation by external id,
 * then run the autonomous path above. Never throws — eager drafting is
 * best-effort and must not fail the webhook.
 */
export async function maybeGenerateProposedReplyForExternal(
  externalConversationId: string,
  source = 'hostaway',
): Promise<void> {
  try {
    const supabase = getSupabaseServer();
    const { data: conv } = await supabase
      .from('conversations')
      .select('id')
      .eq('source', source)
      .eq('external_conversation_id', externalConversationId)
      .maybeSingle();
    if (!conv) return;
    await maybeGenerateProposedReplyForConversation((conv as { id: string }).id, { notify: true });
  } catch (err) {
    console.error('[proposed reply] eager generation failed', {
      externalConversationId,
      err,
    });
  }
}
