import { NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/requireAuthContext';
import { loadConciergeProposalFlags } from '@/src/server/messages/conciergeCapabilities';
import { GUEST_MESSAGE_ATTACHMENT_BUCKET } from '@/src/server/messages/attachments';
import { getSupabaseServer } from '@/lib/supabaseServer';
import type { MessageAttachment } from '@/lib/messages';
import { taskUrl } from '@/src/lib/links';

// The attachment bucket is private, so stored rows hold a path, not a URL. Mint
// a short-lived signed URL per attachment at read time (one batched call for the
// whole thread) via the service client — RLS already authorized the conversation
// read above, and storage has no per-object policy. An attachment whose signing
// fails still returns (as a named file with no url) rather than vanishing.
async function attachSignedUrls(
  service: ReturnType<typeof getSupabaseServer>,
  messages: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  const paths: string[] = [];
  for (const m of messages) {
    const atts = (m.attachments as MessageAttachment[] | null) ?? [];
    for (const a of atts) if (a?.storage_path) paths.push(a.storage_path);
  }
  if (paths.length === 0) return messages;

  const signed = new Map<string, string>();
  const { data } = await service.storage
    .from(GUEST_MESSAGE_ATTACHMENT_BUCKET)
    .createSignedUrls(paths, 60 * 60);
  for (const row of data ?? []) {
    if (row.signedUrl && row.path) signed.set(row.path, row.signedUrl);
  }

  return messages.map((m) => {
    const atts = (m.attachments as MessageAttachment[] | null) ?? [];
    if (atts.length === 0) return m;
    return {
      ...m,
      attachments: atts.map((a) => ({ ...a, url: signed.get(a.storage_path) })),
    };
  });
}

// Thread for one conversation: the conversation header + its messages (oldest
// first), for the detail view.
export async function GET(
  _request: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  const ctx = await requireAuthContext();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, service } = ctx;

  const { conversationId } = await context.params;

  const { data: conversation, error: convError } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', conversationId)
    .maybeSingle();
  if (convError) {
    return NextResponse.json({ error: convError.message }, { status: 500 });
  }
  if (!conversation) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { data: messages, error: msgError } = await supabase
    .from('guest_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('sent_at', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: true });
  if (msgError) {
    return NextResponse.json({ error: msgError.message }, { status: 500 });
  }

  // Pending AND accepted concierge-proposed tasks for this conversation.
  // Multiple can coexist (one per distinct issue); each renders anchored to the
  // message that triggered it. Pending ones render as an editable card; accepted
  // ones render as an "approved by … " tombstone (kept in-thread, not dropped).
  // Dismissed proposals are excluded. Oldest first so they read in order.
  const { data: proposedTaskRows } = await supabase
    .from('proposed_tasks')
    .select(
      'id, title, description, priority, triggering_message_id, department_id, departments(name), suggested_assignee_ids, scheduled_date, scheduled_time, status, decided_by, decided_at, resulting_task_id',
    )
    .eq('conversation_id', conversationId)
    .in('status', ['pending', 'accepted'])
    .order('generated_at', { ascending: true });

  const taskRows = (proposedTaskRows ?? []) as Array<Record<string, unknown>>;

  // Resolve decider display names for accepted proposals (the tombstone shows
  // who approved it). One batched lookup keyed by the distinct decider ids.
  const deciderIds = Array.from(
    new Set(
      taskRows
        .map((r) => r.decided_by as string | null)
        .filter((v): v is string => !!v),
    ),
  );
  const deciderNames = new Map<string, string>();
  if (deciderIds.length) {
    const { data: deciders } = await supabase
      .from('users')
      .select('id, name')
      .in('id', deciderIds);
    for (const u of (deciders ?? []) as Array<{ id: string; name: string | null }>) {
      deciderNames.set(u.id, u.name ?? '');
    }
  }

  const proposed_tasks = taskRows.map((r) => {
    const resultingTaskId = (r.resulting_task_id as string | null) ?? null;
    const decidedBy = (r.decided_by as string | null) ?? null;
    return {
      id: r.id as string,
      title: (r.title as string | null) ?? '',
      description: (r.description as string | null) ?? null,
      priority: (r.priority as string | null) ?? 'medium',
      triggering_message_id: (r.triggering_message_id as string | null) ?? null,
      department_id: (r.department_id as string | null) ?? null,
      department_name: ((r.departments as { name: string | null } | null)?.name) ?? null,
      suggested_assignee_ids: (r.suggested_assignee_ids as string[] | null) ?? [],
      scheduled_date: (r.scheduled_date as string | null) ?? null,
      scheduled_time: (r.scheduled_time as string | null) ?? null,
      status: (r.status as string | null) ?? 'pending',
      decided_by_name: decidedBy ? deciderNames.get(decidedBy) ?? null : null,
      decided_at: (r.decided_at as string | null) ?? null,
      resulting_task_id: resultingTaskId,
      task_url: resultingTaskId ? taskUrl(resultingTaskId) : null,
    };
  });

  // Pending, accepted, AND dismissed concierge-proposed knowledge additions.
  // Pending → editable bubble (attribute or room/area note); accepted → an
  // "approved by … " tombstone; dismissed → a "dismissed by … " tombstone (kept
  // in-thread as a record, not dropped). Oldest first.
  const { data: knowledgeRows } = await supabase
    .from('proposed_knowledge')
    .select(
      'id, summary, guest_visible, triggering_message_id, target, status, decided_by, decided_at, resulting_resource_type, resulting_resource_id',
    )
    .eq('conversation_id', conversationId)
    .in('status', ['pending', 'accepted', 'dismissed'])
    .order('generated_at', { ascending: true });

  const knowledgeRowsArr = (knowledgeRows ?? []) as Array<Record<string, unknown>>;

  // Resolve any knowledge-decider names not already looked up for tasks.
  const knowledgeDeciderIds = knowledgeRowsArr
    .map((r) => r.decided_by as string | null)
    .filter((v): v is string => !!v && !deciderNames.has(v));
  if (knowledgeDeciderIds.length) {
    const { data: kDeciders } = await supabase
      .from('users')
      .select('id, name')
      .in('id', Array.from(new Set(knowledgeDeciderIds)));
    for (const u of (kDeciders ?? []) as Array<{ id: string; name: string | null }>) {
      deciderNames.set(u.id, u.name ?? '');
    }
  }

  const proposed_knowledge = knowledgeRowsArr.map((r) => {
    const decidedBy = (r.decided_by as string | null) ?? null;
    return {
      id: r.id as string,
      summary: (r.summary as string | null) ?? '',
      guest_visible: Boolean(r.guest_visible),
      triggering_message_id: (r.triggering_message_id as string | null) ?? null,
      target: (r.target as Record<string, unknown> | null) ?? null,
      status: (r.status as string | null) ?? 'pending',
      decided_by_name: decidedBy ? deciderNames.get(decidedBy) ?? null : null,
      decided_at: (r.decided_at as string | null) ?? null,
      resulting_resource_type: (r.resulting_resource_type as string | null) ?? null,
      resulting_resource_id: (r.resulting_resource_id as string | null) ?? null,
    };
  });

  // Whether this org drafts replies autonomously. The thread needs it to decide
  // whether to render the proposal bubble at all: with the switch off and nothing
  // drafted, an unprompted "Proposed Reply" affordance would be advertising a
  // capability the operator turned off. An already-stored draft still renders —
  // flipping the switch off shouldn't hide work already done.
  const { reply: reply_proposal_enabled } = await loadConciergeProposalFlags(ctx.orgId);

  const messagesWithUrls = await attachSignedUrls(
    service,
    (messages ?? []) as Array<Record<string, unknown>>,
  );

  return NextResponse.json({
    conversation,
    messages: messagesWithUrls,
    proposed_tasks,
    proposed_knowledge,
    reply_proposal_enabled,
  });
}
