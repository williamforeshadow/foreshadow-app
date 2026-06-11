import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { getCurrentAppUser } from '@/src/server/users/currentUser';
import { getActorUserIdFromRequest } from '@/lib/getActorFromRequest';
import { createTask as createTaskService } from '@/src/server/tasks/createTask';
import { taskUrl } from '@/src/lib/links';

// Accept / dismiss a concierge-proposed task.
//
// A proposed_tasks row is a DURABLE preview: the concierge drafted it from a
// guest message and parked it for review. Accepting it (POST) IS the human
// confirmation, so we skip the agent's token protocol and call the same
// createTaskService commit path directly, attributing the new task to the
// clicking user. Dismissing it (DELETE) just records the decision.

export const maxDuration = 60;

interface ProposedTaskRow {
  id: string;
  conversation_id: string;
  status: 'pending' | 'accepted' | 'dismissed';
  resulting_task_id: string | null;
  title: string;
  description: string | null;
  priority: string;
  property_id: string | null;
  department_id: string | null;
  suggested_assignee_ids: string[] | null;
}

async function requireUser() {
  const { user, error } = await getCurrentAppUser();
  if (error === 'unauthenticated') {
    return {
      response: NextResponse.json({ error: 'Not signed in' }, { status: 401 }),
      user: null,
    };
  }
  if (error === 'unlinked' || !user) {
    return {
      response: NextResponse.json(
        { error: 'No Foreshadow profile is linked to this account' },
        { status: 403 },
      ),
      user: null,
    };
  }
  return { response: null, user };
}

async function loadProposal(id: string): Promise<ProposedTaskRow | null> {
  const { data, error } = await getSupabaseServer()
    .from('proposed_tasks')
    .select(
      'id, conversation_id, status, resulting_task_id, title, description, priority, property_id, department_id, suggested_assignee_ids',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ProposedTaskRow | null) ?? null;
}

// POST — accept: create the real task and mark the proposal accepted.
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { response, user } = await requireUser();
  if (response || !user) return response;

  const { id } = await context.params;
  const actorId = getActorUserIdFromRequest(request) ?? user.id;

  let proposal: ProposedTaskRow | null;
  try {
    proposal = await loadProposal(id);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Lookup failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
  if (!proposal) {
    return NextResponse.json({ error: 'Proposed task not found' }, { status: 404 });
  }

  // Idempotent: if it was already accepted, return the task it created rather
  // than creating a duplicate (handles double-clicks / retries).
  if (proposal.status !== 'pending') {
    if (proposal.status === 'accepted' && proposal.resulting_task_id) {
      return NextResponse.json({
        already: true,
        task_id: proposal.resulting_task_id,
        task_url: taskUrl(proposal.resulting_task_id),
      });
    }
    return NextResponse.json(
      { error: `Proposal already ${proposal.status}` },
      { status: 409 },
    );
  }

  const result = await createTaskService(
    {
      title: proposal.title,
      description: proposal.description,
      priority: proposal.priority as 'urgent' | 'high' | 'medium' | 'low',
      property_id: proposal.property_id,
      department_id: proposal.department_id,
      assigned_user_ids: proposal.suggested_assignee_ids ?? [],
    },
    { actor: { user_id: actorId, name: user.name } },
  );

  if (!result.ok) {
    const status =
      result.error.code === 'not_found'
        ? 404
        : result.error.code === 'invalid_input'
          ? 400
          : 500;
    return NextResponse.json({ error: result.error.message }, { status });
  }

  const { error: updateError } = await getSupabaseServer()
    .from('proposed_tasks')
    .update({
      status: 'accepted',
      resulting_task_id: result.task.task_id,
      decided_by: actorId,
      decided_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'pending');
  if (updateError) {
    // The task was created; surface the link even though the proposal flip
    // failed (a stale pending bubble is recoverable, a lost task isn't).
    console.error('[proposed task] accept: status flip failed', { id, updateError });
  }

  return NextResponse.json({
    task: result.task,
    task_url: taskUrl(result.task.task_id),
  });
}

// DELETE — dismiss: record the decision, create nothing.
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { response, user } = await requireUser();
  if (response || !user) return response;

  const { id } = await context.params;
  const actorId = getActorUserIdFromRequest(request) ?? user.id;

  const { data, error } = await getSupabaseServer()
    .from('proposed_tasks')
    .update({
      status: 'dismissed',
      decided_by: actorId,
      decided_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  // No row updated → already decided or missing; treat as success (idempotent).
  return NextResponse.json({ ok: true, dismissed: Boolean(data) });
}
