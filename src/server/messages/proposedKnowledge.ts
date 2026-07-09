import { getSupabaseServer } from '@/lib/supabaseServer';
import { getConversationContext } from './conversationContext';
import { getLatestSentMessage } from './proposedReply';
import { loadConciergeProposalFlags } from './conciergeCapabilities';
import { generateProposedKnowledgeFromContext } from './draftKnowledge';
import { notifyProposedKnowledge } from '@/src/server/notifications/notifyProposal';

// Persisted proposed-knowledge additions. The concierge reviews a conversation
// and, when it revealed a durable, reusable fact about the property, stores a
// pending proposal. The inbox surfaces each as a bubble; a human accepts (→
// writes into property knowledge) or dismisses. Mirrors proposedTask.ts.

/** Triage a conversation and persist a row per knowledge proposal, notifying each. */
export async function generateAndStoreProposedKnowledge(
  conversationId: string,
  triggeringMessageId: string | null,
): Promise<string[]> {
  const ctx = await getConversationContext(conversationId);
  if (!ctx) return [];

  const result = await generateProposedKnowledgeFromContext(ctx);
  if (result.proposals.length === 0) return [];

  const propertyId = ctx.conversation.property_id ?? null;
  const propertyName =
    ctx.reservation?.property_name ?? ctx.conversation.property_name ?? null;

  const rows = result.proposals.map((p) => ({
    conversation_id: conversationId,
    triggering_message_id: triggeringMessageId,
    property_id: propertyId,
    target: p.target,
    summary: p.summary,
    guest_visible: p.guest_visible,
    status: 'pending',
    source: 'auto',
    reasoning: p.reasoning || result.reasoning || null,
  }));

  const { data, error } = await getSupabaseServer()
    .from('proposed_knowledge')
    .insert(rows)
    .select('id, summary');
  if (error) throw new Error(error.message);

  const inserted = (data ?? []) as Array<{ id: string; summary: string }>;
  for (const row of inserted) {
    await notifyProposedKnowledge({
      proposedKnowledgeId: row.id,
      conversationId,
      propertyId,
      propertyName,
      summary: row.summary,
    });
  }

  return inserted.map((r) => r.id);
}

/** Whether the conversation has at least one host (outbound) message. */
async function threadHasHostMessage(conversationId: string): Promise<boolean> {
  const { data } = await getSupabaseServer()
    .from('guest_messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('direction', 'outbound')
    .limit(1)
    .maybeSingle();
  return Boolean((data as { id: string } | null)?.id);
}

/**
 * Core runner: triage a conversation for knowledge, best-effort. `requireHostMessage`
 * gates the per-message path (knowledge usually originates from a host message /
 * resolved exchange); the on-complete path passes it false. Never throws.
 */
export async function maybeGenerateProposedKnowledgeForConversation(
  conversationId: string,
  opts: { requireHostMessage?: boolean } = {},
): Promise<void> {
  try {
    // Master switch (per the conversation's org): when autonomous knowledge
    // proposing is off, skip entirely. This is the single chokepoint for all
    // autonomous knowledge generation (both the per-message eager hook and any
    // on-complete caller). operations_settings is per-org.
    const { data: orgRow } = await getSupabaseServer()
      .from('conversations')
      .select('org_id')
      .eq('id', conversationId)
      .maybeSingle();
    const convOrgId =
      ((orgRow as { org_id?: string | null } | null)?.org_id as string | null) ?? null;
    if (!(await loadConciergeProposalFlags(convOrgId)).knowledge) return;

    if (opts.requireHostMessage && !(await threadHasHostMessage(conversationId))) {
      return;
    }
    const latest = await getLatestSentMessage(conversationId);
    await generateAndStoreProposedKnowledge(conversationId, latest?.id ?? null);
  } catch (err) {
    console.error('[proposed knowledge] generation failed', { conversationId, err });
  }
}

/**
 * Per-message eager hook (webhook/sandbox): resolve the canonical conversation by
 * external id, then triage IF active, not archived, and the thread already has a
 * host message. Never throws.
 */
export async function maybeGenerateProposedKnowledgeForExternal(
  externalConversationId: string,
  source = 'hostaway',
): Promise<void> {
  try {
    const { data: conv } = await getSupabaseServer()
      .from('conversations')
      .select('id, app_status, archived')
      .eq('source', source)
      .eq('external_conversation_id', externalConversationId)
      .maybeSingle();
    if (!conv) return;
    const c = conv as { id: string; app_status: 'active' | 'complete'; archived: boolean };
    if (c.archived || c.app_status !== 'active') return;
    await maybeGenerateProposedKnowledgeForConversation(c.id, { requireHostMessage: true });
  } catch (err) {
    console.error('[proposed knowledge] eager generation failed', {
      externalConversationId,
      err,
    });
  }
}
