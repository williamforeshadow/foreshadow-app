import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { getCurrentAppUser } from '@/src/server/users/currentUser';
import { taskUrl } from '@/src/lib/links';

// Thread for one conversation: the conversation header + its messages (oldest
// first), for the detail view.
export async function GET(
  _request: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  const { user, error } = await getCurrentAppUser();
  if (error === 'unauthenticated') {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }
  if (error === 'unlinked' || !user) {
    return NextResponse.json(
      { error: 'No Foreshadow profile is linked to this account' },
      { status: 403 },
    );
  }

  const { conversationId } = await context.params;
  const supabase = getSupabaseServer();

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
      'id, title, description, priority, triggering_message_id, department_id, departments(name), status, decided_by, decided_at, resulting_task_id',
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
      status: (r.status as string | null) ?? 'pending',
      decided_by_name: decidedBy ? deciderNames.get(decidedBy) ?? null : null,
      decided_at: (r.decided_at as string | null) ?? null,
      resulting_task_id: resultingTaskId,
      task_url: resultingTaskId ? taskUrl(resultingTaskId) : null,
    };
  });

  // Pending concierge-proposed knowledge additions, oldest first.
  const { data: knowledgeRows } = await supabase
    .from('proposed_knowledge')
    .select('id, summary, guest_visible, triggering_message_id')
    .eq('conversation_id', conversationId)
    .eq('status', 'pending')
    .order('generated_at', { ascending: true });

  const proposed_knowledge = ((knowledgeRows ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    summary: (r.summary as string | null) ?? '',
    guest_visible: Boolean(r.guest_visible),
    triggering_message_id: (r.triggering_message_id as string | null) ?? null,
  }));

  return NextResponse.json({
    conversation,
    messages: messages ?? [],
    proposed_tasks,
    proposed_knowledge,
  });
}
