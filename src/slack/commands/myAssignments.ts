import type { Block, MessageAttachment } from '@slack/types';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { taskUrl } from '@/src/lib/links';
import { getTasksByIds, type TaskByIdRow } from '@/src/server/tasks/getTaskById';
import { renderTaskRowsAsExtras } from '@/src/slack/unfurl';

// Handler for the `/myassignments` Slack slash command.
//
// Why this exists separately from the agent: the question this command
// answers — "what tasks am I currently assigned to?" — is fully
// deterministic. The user is already resolved (the slash command webhook
// gives us the Slack user_id, which the dispatcher maps to our user_id),
// and the data shape is fixed (open tasks where task_assignments.user_id
// matches). Routing this through the LLM would add latency, cost, and
// hallucination risk for zero gain. We just query directly and reuse the
// existing task-card builders so the visual output matches what the
// agent would have produced.
//
// Filtering rules (mirror the in-app My Assignments page exactly):
//   - Only tasks where task_assignments.user_id = the resolved app user.
//   - Drop completed tasks (status = 'complete') — already done.
//   - Do NOT filter by is_binned. "Binned" in this codebase means
//     "filed into a project bin" (Backlog, Triage, etc.) — it's a
//     categorization, not a hide. The in-app My Assignments view
//     keeps binned tasks visible and we want byte-for-byte parity so
//     the counts match between surfaces.
//   - Sort: scheduled_date asc with nulls last, then created_at asc as a
//     stable tiebreaker. "What's next?" is the natural reading order.
//
// Output:
//   - 0 results → ephemeral text "You have no open assignments." (no cards)
//   - 1+ results → a `text` summary line + the same carousel/attachment
//     layout the unfurl path uses (carousel for ≤10, attachments for >10).

export interface MyAssignmentsResult {
  /** Human-readable summary line shown above the cards. */
  text: string;
  /** Optional carousel block when the count is ≤10. */
  blocks?: Block[];
  /** Optional vertical attachments when the count is >10. */
  attachments?: MessageAttachment[];
}

/**
 * Run the /myassignments query for an already-resolved app user and
 * return the Slack-shaped response payload.
 */
export async function runMyAssignments(args: {
  appUserId: string;
  displayName: string;
}): Promise<MyAssignmentsResult> {
  const { appUserId, displayName } = args;

  const supabase = getSupabaseServer();
  // Step 1: pull the assignment rows for this user. We keep this as a
  // separate query (instead of joining task_assignments → turnover_tasks
  // in one round-trip) because the second step reuses getTasksByIds,
  // which already encapsulates the full select shape and shaping logic
  // shared with the unfurl path. One extra query is cheap and the code
  // stays consistent.
  const { data: assignmentRows, error: assignmentErr } = await supabase
    .from('task_assignments')
    .select('task_id')
    .eq('user_id', appUserId);
  if (assignmentErr) {
    console.error('[slack/commands] task_assignments query failed', {
      appUserId,
      err: assignmentErr,
    });
    return {
      text: `Sorry — I couldn't load your assignments right now. Try again in a moment.`,
    };
  }
  const rows = (assignmentRows ?? []) as Array<{ task_id: string }>;
  const assignedIds = Array.from(new Set(rows.map((r) => r.task_id)));
  if (assignedIds.length === 0) {
    return {
      text: `${displayName}, you have no open assignments. Nice.`,
    };
  }

  // Step 2: fetch the full task rows so we can both filter on status
  // (which the assignment table doesn't carry) and feed the shared
  // card renderer.
  const allTasks = await getTasksByIds(assignedIds);
  const openTasks = allTasks.filter((t) => t.status !== 'complete');
  if (openTasks.length === 0) {
    return {
      text: `${displayName}, you have no open assignments. Nice.`,
    };
  }

  // Step 3: sort by scheduled date asc with nulls last, then created_at
  // asc. This puts "due today / soon" at the top and "no date set"
  // tasks at the bottom — the natural "what should I look at first"
  // reading order. We do this in JS rather than in SQL to keep the
  // assignment query simple and because the result count is bounded
  // by what one user can possibly be assigned to (small).
  openTasks.sort(compareTasksForAssignmentList);

  // Step 4: shape into (task, url) pairs and render via the shared
  // helper. Using taskUrl() keeps the URL exactly the same as what the
  // agent's tools return, so links from /myassignments and from the
  // agent are interchangeable.
  const ordered = openTasks.map((task) => ({
    task,
    url: taskUrl(task.task_id),
  }));
  const extras = renderTaskRowsAsExtras(ordered);

  // Summary line: keep it short. "You have N open assignments" reads
  // well in Slack mrkdwn.
  const noun = openTasks.length === 1 ? 'assignment' : 'assignments';
  const text = `${displayName}, you have ${openTasks.length} open ${noun}:`;

  return {
    text,
    ...extras,
  };
}

// Comparator for the sort step above. Pulled out so the rule is easy
// to read at a glance and independently testable later.
function compareTasksForAssignmentList(
  a: TaskByIdRow,
  b: TaskByIdRow,
): number {
  const ad = a.scheduled_date;
  const bd = b.scheduled_date;
  if (ad && bd) {
    if (ad !== bd) return ad < bd ? -1 : 1;
    // Same date — fall through to time / created_at tiebreakers.
    const at = a.scheduled_time ?? '';
    const bt = b.scheduled_time ?? '';
    if (at !== bt) return at < bt ? -1 : 1;
  } else if (ad && !bd) {
    return -1;
  } else if (!ad && bd) {
    return 1;
  }
  // Stable tiebreaker: oldest first. Newest tasks creeping to the top
  // would feel arbitrary in an "open assignments" list.
  if (a.created_at !== b.created_at) {
    return a.created_at < b.created_at ? -1 : 1;
  }
  return 0;
}
