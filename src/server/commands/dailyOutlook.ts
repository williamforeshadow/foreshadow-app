import { getSupabaseServer } from '@/lib/supabaseServer';
import { todayInTz, DEFAULT_TIMEZONE } from '@/src/lib/dates';
import { taskUrl } from '@/src/lib/links';
import { getTasksByIds, type TaskByIdRow } from '@/src/server/tasks/getTaskById';
import type { AssignmentTask } from './myAssignments';

// Surface-agnostic data layer for the "daily outlook" command — today's
// reservation check-ins/outs plus the invoking user's tasks scheduled for
// today. Shared by the Slack `/dailyoutlook` handler and the in-app chat
// command so both surfaces report identical data.
//
// Timezone: "today" is resolved against the org default timezone.
// Property-level timezones are not yet factored in (same simplification as
// /myassignments).

export interface ReservationSummary {
  property_name: string;
  guest_name: string | null;
}

export interface DailyOutlookData {
  /** False only when the task query errored. */
  ok: boolean;
  /** YYYY-MM-DD "today" in the org timezone. */
  date: string;
  checkOuts: ReservationSummary[];
  checkIns: ReservationSummary[];
  tasks: AssignmentTask[];
}

export async function getDailyOutlookData(
  appUserId: string,
): Promise<DailyOutlookData> {
  const supabase = getSupabaseServer();

  let orgTimezone = DEFAULT_TIMEZONE;
  try {
    const { data: settings } = await supabase
      .from('operations_settings')
      .select('default_timezone')
      .eq('id', 1)
      .maybeSingle();
    if (settings?.default_timezone) orgTimezone = settings.default_timezone;
  } catch {
    // Table may not exist yet — use the constant default.
  }
  const { date: today } = todayInTz(orgTimezone);

  const [checkOutRes, checkInRes] = await Promise.all([
    supabase
      .from('reservations')
      .select('property_name, guest_name')
      .eq('check_out', today)
      .order('property_name', { ascending: true }),
    supabase
      .from('reservations')
      .select('property_name, guest_name')
      .eq('check_in', today)
      .order('property_name', { ascending: true }),
  ]);

  const toSummary = (rows: unknown): ReservationSummary[] =>
    (
      (rows ?? []) as Array<{
        property_name: string | null;
        guest_name: string | null;
      }>
    ).map((r) => ({
      property_name: r.property_name || 'Unknown property',
      guest_name: r.guest_name,
    }));
  const checkOuts = toSummary(checkOutRes.data);
  const checkIns = toSummary(checkInRes.data);

  const { data: assignmentRows, error } = await supabase
    .from('task_assignments')
    .select('task_id')
    .eq('user_id', appUserId);
  if (error) {
    console.error('[commands/dailyOutlook] task_assignments query failed', {
      appUserId,
      err: error,
    });
    return { ok: false, date: today, checkOuts, checkIns, tasks: [] };
  }

  const assignedIds = Array.from(
    new Set(
      ((assignmentRows ?? []) as Array<{ task_id: string }>).map(
        (r) => r.task_id,
      ),
    ),
  );

  let todayTasks: TaskByIdRow[] = [];
  if (assignedIds.length > 0) {
    todayTasks = (await getTasksByIds(assignedIds)).filter(
      (t) => t.status !== 'complete' && t.scheduled_date === today,
    );
  }
  // scheduled_time asc (nulls last), then created_at asc.
  todayTasks.sort((a, b) => {
    const at = a.scheduled_time ?? '\xff';
    const bt = b.scheduled_time ?? '\xff';
    if (at !== bt) return at < bt ? -1 : 1;
    return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
  });

  return {
    ok: true,
    date: today,
    checkOuts,
    checkIns,
    tasks: todayTasks.map((task) => ({ task, url: taskUrl(task.task_id) })),
  };
}
