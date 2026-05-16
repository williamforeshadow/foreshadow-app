import { NextResponse } from 'next/server';
import { runScheduleTick } from '@/src/server/automations/runSchedule';

// Hourly cron — fires scheduled automations from the new engine.
//
// Schedule is configured in vercel.json: `0 * * * *`. Each tick we ask the
// runner which schedules are due "this hour" in their resolved timezone
// and fire them. Row-change automations are not touched here — those run
// inline from the mutation paths (Hostaway sync, etc.).
//
// GET delegates to POST so it's easy to fire manually by visiting the URL.

export const maxDuration = 60;

export async function POST() {
  const now = new Date();
  const results = await runScheduleTick(now);
  return NextResponse.json({
    ran_at: now.toISOString(),
    automations_considered: results.length,
    fired: results.filter((r) => r.due && r.ok).length,
    skipped_not_due: results.filter((r) => r.due === false).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
}

export async function GET() {
  return POST();
}
