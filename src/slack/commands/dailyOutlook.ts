import type { Block } from '@slack/types';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { todayInTz, DEFAULT_TIMEZONE } from '@/src/lib/dates';
import { taskUrl } from '@/src/lib/links';
import { getTasksByIds, type TaskByIdRow } from '@/src/server/tasks/getTaskById';
import {
  buildDailyOutlookBlocks,
  dailyOutlookText,
  type ReservationSummary,
} from '@/src/slack/dailyOutlookBlocks';

// Handler for the `/dailyoutlook` Slack slash command.
//
// Shows the invoking user a full overview of today:
//   - Reservation check-outs happening today (across all properties)
//   - Reservation check-ins happening today (across all properties)
//   - All tasks scheduled for today that the user is assigned to
//
// Like /myassignments, the response is ephemeral (only the invoker sees it)
// and the query is fully deterministic — no LLM involvement.
//
// Timezone resolution: uses the org default timezone to resolve "today".
// Property-level timezones are not yet factored in here (same simplification
// as /myassignments). When we add per-property timezone support to the query
// layer, this handler inherits it.

export interface DailyOutlookResult {
  text: string;
  blocks: Block[];
}

export async function runDailyOutlook(args: {
  appUserId: string;
  displayName: string;
}): Promise<DailyOutlookResult> {
  const { appUserId, displayName } = args;
  const supabase = getSupabaseServer();

  // Resolve "today" using the org default timezone.
  let orgTimezone = DEFAULT_TIMEZONE;
  try {
    const { data: settings } = await supabase
      .from('operations_settings')
      .select('default_timezone')
      .eq('id', 1)
      .maybeSingle();
    if (settings?.default_timezone) {
      orgTimezone = settings.default_timezone;
    }
  } catch {
    // Table may not exist yet — use the constant default.
  }

  const { date: today } = todayInTz(orgTimezone);

  // ── Reservations ────────────────────────────────────────────────────
  // Check-outs = reservations where check_out = today
  // Check-ins  = reservations where check_in = today
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

  const checkOuts: ReservationSummary[] = ((checkOutRes.data ?? []) as Array<{
    property_name: string | null;
    guest_name: string | null;
  }>).map((r) => ({
    property_name: r.property_name || 'Unknown property',
    guest_name: r.guest_name,
  }));

  const checkIns: ReservationSummary[] = ((checkInRes.data ?? []) as Array<{
    property_name: string | null;
    guest_name: string | null;
  }>).map((r) => ({
    property_name: r.property_name || 'Unknown property',
    guest_name: r.guest_name,
  }));

  // ── Tasks ───────────────────────────────────────────────────────────
  // All tasks scheduled for today that the invoking user is assigned to.
  const { data: assignmentRows, error: assignmentErr } = await supabase
    .from('task_assignments')
    .select('task_id')
    .eq('user_id', appUserId);

  if (assignmentErr) {
    console.error('[slack/commands/dailyOutlook] task_assignments query failed', {
      appUserId,
      err: assignmentErr,
    });
    return {
      text: `Sorry — I couldn't load your daily outlook right now. Try again in a moment.`,
      blocks: [],
    };
  }

  const rows = (assignmentRows ?? []) as Array<{ task_id: string }>;
  const assignedIds = Array.from(new Set(rows.map((r) => r.task_id)));

  let todayTasks: TaskByIdRow[] = [];
  if (assignedIds.length > 0) {
    const allTasks = await getTasksByIds(assignedIds);
    todayTasks = allTasks.filter(
      (t) => t.status !== 'complete' && t.scheduled_date === today,
    );
  }

  // Sort: scheduled_time asc (nulls last), then created_at asc.
  todayTasks.sort((a, b) => {
    const at = a.scheduled_time ?? '\xff';
    const bt = b.scheduled_time ?? '\xff';
    if (at !== bt) return at < bt ? -1 : 1;
    return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
  });

  // Nothing at all? Return a simple text message.
  if (todayTasks.length === 0 && checkOuts.length === 0 && checkIns.length === 0) {
    return {
      text: `${displayName}, nothing on the board today. Enjoy the quiet.`,
      blocks: [],
    };
  }

  const orderedTasks = todayTasks.map((task) => ({
    task,
    url: taskUrl(task.task_id),
  }));

  const blocks = buildDailyOutlookBlocks({
    dateStr: today,
    checkOuts,
    checkIns,
    orderedTasks,
  });

  const text = dailyOutlookText({
    displayName,
    taskCount: todayTasks.length,
    checkOutCount: checkOuts.length,
    checkInCount: checkIns.length,
  });

  return { text, blocks };
}
