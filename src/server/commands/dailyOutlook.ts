import { getSupabaseServer } from '@/lib/supabaseServer';
import { todayInTz, addDays, DEFAULT_TIMEZONE } from '@/src/lib/dates';
import { taskUrl } from '@/src/lib/links';
import { getTasksByIds, type TaskByIdRow } from '@/src/server/tasks/getTaskById';
import type { AssignmentTask } from './myAssignments';

// Surface-agnostic data layer for the "daily outlook" family of commands —
// a target day's reservation check-ins/outs plus the invoking user's tasks
// scheduled for that day. Shared by the Slack handlers and the in-app chat
// commands so both surfaces report identical data.
//
// `offsetDays` selects the target day relative to "today": 0 powers
// /dailyoutlook, 1 powers /tomorrow. Reservations and tasks are filtered on
// the resolved calendar date, so the whole query path is reused unchanged.
//
// Timezone: "today" is resolved against the org default timezone, and the
// offset is added as plain calendar days. Property-level timezones are not
// yet factored in (same simplification as /myassignments).

export interface ReservationSummary {
  property_name: string;
  guest_name: string | null;
}

export interface DailyOutlookData {
  /** False only when the task query errored. */
  ok: boolean;
  /** YYYY-MM-DD target day (today + offsetDays) in the org timezone. */
  date: string;
  checkOuts: ReservationSummary[];
  checkIns: ReservationSummary[];
  tasks: AssignmentTask[];
}

export async function getDailyOutlookData(
  appUserId: string,
  offsetDays = 0,
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
  const targetDate = offsetDays === 0 ? today : addDays(today, offsetDays);

  const [checkOutRes, checkInRes] = await Promise.all([
    supabase
      .from('reservations')
      .select('property_name, guest_name')
      .eq('check_out', targetDate)
      .order('property_name', { ascending: true }),
    supabase
      .from('reservations')
      .select('property_name, guest_name')
      .eq('check_in', targetDate)
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
    return { ok: false, date: targetDate, checkOuts, checkIns, tasks: [] };
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
      (t) => t.status !== 'complete' && t.scheduled_date === targetDate,
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
    date: targetDate,
    checkOuts,
    checkIns,
    tasks: todayTasks.map((task) => ({ task, url: taskUrl(task.task_id) })),
  };
}
