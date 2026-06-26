import { getSupabaseServer } from '@/lib/supabaseServer';
import { getConversationContext } from './conversationContext';
import { getLatestSentMessage } from './proposedReply';
import { loadConciergeProposalFlags } from './conciergeCapabilities';
import { generateProposedTaskDraftFromContext } from './draftTask';
import { notifyProposedTask } from '@/src/server/notifications/notifyProposal';

// Persisted proposed tasks. The concierge triages an inbound guest message and,
// for each distinct issue that meets the threshold, stores a pending row. The
// inbox surfaces each as a "proposed task" bubble; a human accepts (→
// createTaskService) or dismisses it. Multiple tasks can come from one message.
// Mirrors proposedReply.ts.

/**
 * Triage a conversation and PERSIST a pending proposed_tasks row for EACH
 * distinct task the model returns, emitting a notification per task. Returns the
 * new proposal ids (empty when nothing was drafted). Throws on generation/DB
 * errors (the eager hook below swallows them).
 */
export async function generateAndStoreProposedTask(
  conversationId: string,
  triggeringMessageId: string | null,
): Promise<string[]> {
  const ctx = await getConversationContext(conversationId);
  if (!ctx) return [];

  const result = await generateProposedTaskDraftFromContext(ctx);
  if (result.tasks.length === 0) return [];

  const propertyId = ctx.conversation.property_id ?? null;
  const propertyName =
    ctx.reservation?.property_name ?? ctx.conversation.property_name ?? null;
  const guestName =
    ctx.reservation?.guest_name ?? ctx.conversation.guest_name ?? null;

  const rows = result.tasks.map((task) => ({
    conversation_id: conversationId,
    triggering_message_id: triggeringMessageId,
    property_id: propertyId,
    title: task.title,
    description: task.description,
    priority: task.priority,
    department_id: task.department_id,
    suggested_assignee_ids: task.suggested_assignee_ids,
    scheduled_date: task.scheduled_date,
    scheduled_time: task.scheduled_time,
    status: 'pending',
    source: 'auto',
    reasoning: result.reasoning || null,
  }));

  const { data, error } = await getSupabaseServer()
    .from('proposed_tasks')
    .insert(rows)
    .select('id, title');
  if (error) throw new Error(error.message);

  const inserted = (data ?? []) as Array<{ id: string; title: string }>;
  for (const row of inserted) {
    await notifyProposedTask({
      proposedTaskId: row.id,
      conversationId,
      propertyId,
      propertyName,
      guestName,
      title: row.title,
    });
  }

  return inserted.map((r) => r.id);
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
    // Master switch: when autonomous task proposing is off, skip entirely.
    if (!(await loadConciergeProposalFlags()).task) return;

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

    // Each inbound message is triaged and can yield several tasks. Dedup is the
    // model's job — the triage prompt sees this conversation's already-raised
    // tasks and won't repeat them (so a follow-up about the same issue makes no
    // new proposal, but genuinely separate issues each become a task).
    await generateAndStoreProposedTask(c.id, latest.id);
  } catch (err) {
    console.error('[proposed task] eager generation failed', {
      externalConversationId,
      err,
    });
  }
}
