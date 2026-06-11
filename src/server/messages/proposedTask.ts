import { getSupabaseServer } from '@/lib/supabaseServer';
import { getConversationContext } from './conversationContext';
import { getLatestSentMessage } from './proposedReply';
import { generateProposedTaskDraftFromContext } from './draftTask';
import { notifyProposedTask } from '@/src/server/notifications/notifyProposal';

// Persisted proposed tasks. The concierge triages an inbound guest message and,
// when it implies operational work, drafts a task ONCE and stores it as a
// pending row. The inbox surfaces it as a "proposed task" bubble; a human
// accepts (→ createTaskService) or dismisses it. Mirrors proposedReply.ts.

interface PendingProposedTask {
  id: string;
}

/** Whether the conversation already has a pending proposal (dedup gate). */
async function hasPendingProposedTask(conversationId: string): Promise<boolean> {
  const { data, error } = await getSupabaseServer()
    .from('proposed_tasks')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('status', 'pending')
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn('[proposed task] pending lookup failed', { conversationId, error });
    // Fail safe: assume one exists so we don't double-draft on a transient error.
    return true;
  }
  return Boolean((data as PendingProposedTask | null)?.id);
}

/**
 * Generate a triage draft for a conversation and, if warranted, PERSIST it as a
 * pending proposed_tasks row + emit a notification. Returns the new proposal id
 * or null when nothing was drafted. Throws on generation/DB errors (the eager
 * hook below swallows them).
 */
export async function generateAndStoreProposedTask(
  conversationId: string,
  triggeringMessageId: string | null,
): Promise<string | null> {
  const ctx = await getConversationContext(conversationId);
  if (!ctx) return null;

  const result = await generateProposedTaskDraftFromContext(ctx);
  if (!result.should_draft || !result.task) return null;

  const propertyId = ctx.conversation.property_id ?? null;
  const propertyName =
    ctx.reservation?.property_name ?? ctx.conversation.property_name ?? null;
  const guestName =
    ctx.reservation?.guest_name ?? ctx.conversation.guest_name ?? null;

  const { data, error } = await getSupabaseServer()
    .from('proposed_tasks')
    .insert({
      conversation_id: conversationId,
      triggering_message_id: triggeringMessageId,
      property_id: propertyId,
      title: result.task.title,
      description: result.task.description,
      priority: result.task.priority,
      department_id: result.task.department_id,
      status: 'pending',
      source: 'auto',
      reasoning: result.reasoning || null,
    })
    .select('id')
    .single();

  if (error) {
    // 23505 = the partial unique index fired (a pending proposal already exists
    // for this triggering message). Treat as already-handled.
    if (error.code === '23505') return null;
    throw new Error(error.message);
  }

  const proposedTaskId = data?.id as string | undefined;
  if (!proposedTaskId) return null;

  await notifyProposedTask({
    proposedTaskId,
    conversationId,
    propertyId,
    propertyName,
    guestName,
    title: result.task.title,
  });

  return proposedTaskId;
}

/**
 * Eager hook for the webhook: after ingest, triage a Hostaway conversation for a
 * task IF it's active, awaiting a guest reply, and has no pending proposal yet.
 * Never throws — best-effort, must not fail the webhook.
 */
export async function maybeGenerateProposedTaskForExternal(
  externalConversationId: string,
  source = 'hostaway',
): Promise<void> {
  try {
    const supabase = getSupabaseServer();
    const { data: conv } = await supabase
      .from('conversations')
      .select('id, app_status, archived')
      .eq('source', source)
      .eq('external_conversation_id', externalConversationId)
      .maybeSingle();
    if (!conv) return;
    const c = conv as {
      id: string;
      app_status: 'active' | 'complete';
      archived: boolean;
    };
    if (c.archived || c.app_status !== 'active') return;

    const latest = await getLatestSentMessage(c.id);
    // Only triage when the guest is the one awaiting action.
    if (!latest || latest.direction !== 'inbound') return;
    // Dedup: one pending proposal per conversation — follow-ups are skipped.
    if (await hasPendingProposedTask(c.id)) return;

    await generateAndStoreProposedTask(c.id, latest.id);
  } catch (err) {
    console.error('[proposed task] eager generation failed', {
      externalConversationId,
      err,
    });
  }
}
