import { getSupabaseServer } from '@/lib/supabaseServer';
import { taskUrl } from '@/src/lib/links';
import { getTasksByIds, type TaskByIdRow } from '@/src/server/tasks/getTaskById';

// Surface-agnostic data layer for the "my assignments" command.
//
// Both the Slack `/myassignments` handler (src/slack/commands/myAssignments.ts)
// and the in-app chat `/myassignments` command (/api/agent/command) call
// getMyAssignmentsData so the two surfaces report byte-for-byte identical
// tasks and counts. Rendering (Slack Block Kit vs. web markdown) lives in
// the respective surface layers.
//
// Filtering rules (mirror the in-app My Assignments page exactly):
//   - Only tasks where task_assignments.user_id = the resolved app user.
//   - Drop completed tasks (status = 'complete').
//   - Do NOT filter by is_binned — "binned" is a categorization, not a hide.
//   - Sort: scheduled_date asc (nulls last), scheduled_time asc (nulls last),
//     then created_at asc as a stable tiebreaker.

export interface AssignmentTask {
  task: TaskByIdRow;
  url: string;
}

export interface MyAssignmentsData {
  /** False only when the underlying query errored. Empty list is ok: true. */
  ok: boolean;
  tasks: AssignmentTask[];
}

export async function getMyAssignmentsData(
  appUserId: string,
): Promise<MyAssignmentsData> {
  const supabase = getSupabaseServer();

  const { data: assignmentRows, error } = await supabase
    .from('task_assignments')
    .select('task_id')
    .eq('user_id', appUserId);
  if (error) {
    console.error('[commands/myAssignments] task_assignments query failed', {
      appUserId,
      err: error,
    });
    return { ok: false, tasks: [] };
  }

  const assignedIds = Array.from(
    new Set(
      ((assignmentRows ?? []) as Array<{ task_id: string }>).map(
        (r) => r.task_id,
      ),
    ),
  );
  if (assignedIds.length === 0) return { ok: true, tasks: [] };

  // Fetch full task rows so we can filter on status (the assignment table
  // doesn't carry it) and render. getTasksByIds encapsulates the shared
  // select shape.
  const openTasks = (await getTasksByIds(assignedIds)).filter(
    (t) => t.status !== 'complete',
  );
  openTasks.sort(compareTasksForAssignmentList);

  return {
    ok: true,
    tasks: openTasks.map((task) => ({ task, url: taskUrl(task.task_id) })),
  };
}

/** scheduled_date asc (nulls last) → scheduled_time asc (nulls last) → created_at asc. */
export function compareTasksForAssignmentList(
  a: TaskByIdRow,
  b: TaskByIdRow,
): number {
  const ad = a.scheduled_date;
  const bd = b.scheduled_date;
  if (ad && bd) {
    if (ad !== bd) return ad < bd ? -1 : 1;
    const at = a.scheduled_time ?? '';
    const bt = b.scheduled_time ?? '';
    if (at !== bt) return at < bt ? -1 : 1;
  } else if (ad && !bd) {
    return -1;
  } else if (!ad && bd) {
    return 1;
  }
  if (a.created_at !== b.created_at) {
    return a.created_at < b.created_at ? -1 : 1;
  }
  return 0;
}
