import { getSupabaseServer } from '@/lib/supabaseServer';
import { generateGuestReplyDraft } from './draftReply';
import { loadConciergeProposalFlags, loadReplyProposalSensitivity } from './conciergeCapabilities';
import { notifyProposedReply } from '@/src/server/notifications/notifyProposal';

// Persisted proposed replies. The Concierge drafts a reply ONCE and we store it
// on the conversation; the inbox reads it instead of regenerating on every open.
// Generation happens in three places, all funneling through here:
//   - eager, when a new guest message arrives (webhook)        → source 'auto'
//   - the inbox "Regenerate" / first-generate button           → source 'auto'
//   - the ops agent's `concierge` tool (often with an instruction) → 'assistant'
//
// `answers_message_id` is the latest sent message the draft was written against,
// so the inbox can tell when a newer guest message has made the draft stale.

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

  // On the autonomous path, gate drafting by the org reply-sensitivity level.
  const replySensitivity = opts.gate ? await loadReplyProposalSensitivity() : undefined;
  const { draft, warranted } = await generateGuestReplyDraft({
    conversationId,
    instruction: opts.instruction,
    replySensitivity,
  });

  // The message didn't clear the sensitivity bar — store nothing, notify no one.
  if (!warranted) {
    return { draft: '', answers_message_id: latest?.id ?? null, skipped: true };
  }

  const { error } = await supabase
    .from('conversations')
    .update({
      proposed_reply: draft,
      proposed_reply_answers_message_id: latest?.id ?? null,
      proposed_reply_source: opts.source,
      proposed_reply_generated_at: new Date().toISOString(),
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

  return { draft, answers_message_id: latest?.id ?? null };
}

/**
 * Eager hook for the webhook: after ingest, draft a reply for a Hostaway
 * conversation IF it's active, awaiting a guest reply, and not already drafted
 * for that exact message. Resolves the canonical conversation by external id.
 * Never throws — eager drafting is best-effort and must not fail the webhook.
 */
export async function maybeGenerateProposedReplyForExternal(
  externalConversationId: string,
  source = 'hostaway',
): Promise<void> {
  try {
    // Master switch: when autonomous reply drafting is off, skip entirely.
    // Manual "Regenerate" and the ops-agent tool call generateAndStoreProposedReply
    // directly and are unaffected.
    if (!(await loadConciergeProposalFlags()).reply) return;

    const supabase = getSupabaseServer();
    const { data: conv } = await supabase
      .from('conversations')
      .select('id, app_status, archived, proposed_reply_answers_message_id')
      .eq('source', source)
      .eq('external_conversation_id', externalConversationId)
      .maybeSingle();
    if (!conv) return;
    const c = conv as {
      id: string;
      app_status: 'active' | 'complete';
      archived: boolean;
      proposed_reply_answers_message_id: string | null;
    };
    if (c.archived || c.app_status !== 'active') return;

    const latest = await getLatestSentMessage(c.id);
    // Only draft when the guest is the one awaiting a reply.
    if (!latest || latest.direction !== 'inbound') return;
    // Already drafted for this exact message — nothing new to answer.
    if (c.proposed_reply_answers_message_id === latest.id) return;

    await generateAndStoreProposedReply(c.id, { source: 'auto', notify: true, gate: true });
  } catch (err) {
    console.error('[proposed reply] eager generation failed', {
      externalConversationId,
      err,
    });
  }
}
