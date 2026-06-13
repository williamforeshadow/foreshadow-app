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
//
// Accept has two entry points that share this route:
//   - Quick-create: POST with no body → create from the stored proposal as-is.
//   - Edited create: POST with a JSON body of edited fields (the inbox opens
//     the same task editor used elsewhere, pre-filled from the proposal) →
//     the edits are merged over the stored proposal before the commit. The
//     proposal is still marked accepted/decided regardless of edits.

export const maxDuration = 60;

// Optional edited fields sent by the inbox task editor. Any omitted field
// falls back to the stored proposal. Empty strings from form inputs are
// coerced to null so they pass createTask's uuid/date validators.
interface AcceptEdits {
  title?: string;
  description?: unknown; // Tiptap JSON doc or plain string
  priority?: string;
  department_id?: string | null;
  property_id?: string | null;
  template_id?: string | null;
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  status?: string;
  assigned_user_ids?: string[];
}

const blankToNull = (v: string | null | undefined): string | null =>
  v == null || v === '' ? null : v;

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

  // Optional edited fields from the inbox task editor. No body → quick-create.
  let edits: AcceptEdits = {};
  try {
    const raw = await request.json();
    if (raw && typeof raw === 'object') edits = raw as AcceptEdits;
  } catch {
    // No/!JSON body — accept the stored proposal verbatim.
  }

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

  // Merge any editor edits over the stored proposal. Each field falls back to
  // the proposal when the editor didn't send it; blanks coerce to null.
  const result = await createTaskService(
    {
      title: edits.title ?? proposal.title,
      description:
        edits.description !== undefined ? edits.description : proposal.description,
      priority: (edits.priority ?? proposal.priority) as
        | 'urgent'
        | 'high'
        | 'medium'
        | 'low',
      status: edits.status as
        | 'contingent'
        | 'not_started'
        | 'in_progress'
        | 'paused'
        | 'complete'
        | undefined,
      property_id:
        edits.property_id !== undefined
          ? blankToNull(edits.property_id)
          : proposal.property_id,
      department_id:
        edits.department_id !== undefined
          ? blankToNull(edits.department_id)
          : proposal.department_id,
      template_id: blankToNull(edits.template_id),
      scheduled_date: blankToNull(edits.scheduled_date),
      scheduled_time: blankToNull(edits.scheduled_time),
      assigned_user_ids: edits.assigned_user_ids ?? proposal.suggested_assignee_ids ?? [],
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
