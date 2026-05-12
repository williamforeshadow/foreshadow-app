import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { todayInTz, DEFAULT_TIMEZONE } from '@/src/lib/dates';
import {
  runScheduledSlackAutomations,
  runSlackAutomationsForTrigger,
} from '@/src/server/slackAutomations/run';

// Daily cron — fires `check_in` and `check_out` Slack automations.
//
// `new_booking` is NOT swept here — that one fires inline from the
// Hostaway sync hook the moment a reservation is inserted.
//
// Schedule (vercel.json): frequent polling. Event sweeps remain deduped, and
// scheduled automations decide whether their local configured time is due.
//
// GET delegates to POST so it's easy to test by hitting the URL in a
// browser, mirroring /api/hostaway/sync.

export const maxDuration = 60;

export async function POST() {
  const supabase = getSupabaseServer();

  // Resolve "today" using the org default timezone. This ensures we use
  // the same date the user would see when looking at their dashboard.
  let orgTimezone = DEFAULT_TIMEZONE;
  try {
    const { data } = await supabase
      .from('operations_settings')
      .select('default_timezone')
      .eq('id', 1)
      .maybeSingle();
    if (data?.default_timezone) orgTimezone = data.default_timezone as string;
  } catch {
    // table might not exist yet
  }
  const { date: today } = todayInTz(orgTimezone);

  const [checkInResult, checkOutResult] = await Promise.all([
    runSlackAutomationsForTrigger({ trigger: 'check_in', date: today }),
    runSlackAutomationsForTrigger({ trigger: 'check_out', date: today }),
  ]);
  const scheduledResult = await runScheduledSlackAutomations();

  const summarize = (r: typeof checkInResult) => ({
    reservations_scanned: r.reservationsScanned,
    fires_attempted: r.fires.length,
    fires_ok: r.fires.filter((f) => f.ok && !f.skipped_reason).length,
    fires_skipped: r.fires.filter((f) => f.skipped_reason).length,
    fires_failed: r.fires.filter((f) => !f.ok).length,
    errors: r.fires.filter((f) => !f.ok).map((f) => f.error).filter(Boolean),
  });

  return NextResponse.json({
    date: today,
    timezone: orgTimezone,
    check_in: summarize(checkInResult),
    check_out: summarize(checkOutResult),
    scheduled: {
      automations_scanned: scheduledResult.automationsScanned,
      contexts_scanned: scheduledResult.contextsScanned,
      fires_attempted: scheduledResult.fires.length,
      fires_ok: scheduledResult.fires.filter((f) => f.ok && !f.skipped_reason).length,
      fires_skipped: scheduledResult.fires.filter((f) => f.skipped_reason).length,
      fires_failed: scheduledResult.fires.filter((f) => !f.ok).length,
      errors: scheduledResult.fires.filter((f) => !f.ok).map((f) => f.error).filter(Boolean),
    },
  });
}

export async function GET() {
  return POST();
}
