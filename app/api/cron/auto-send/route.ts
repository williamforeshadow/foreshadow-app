import { NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/requireCronAuth';
import { runAutoSendTick } from '@/src/server/messages/autoSend';

// Every-minute cron — fires Concierge auto-sends that have come due.
//
// Schedule is configured in vercel.json: `* * * * *`. The minimum configurable
// delay is 1 minute, so the tick has to run at least that often or the floor
// would be a lie. Ticks are cheap when nothing is due: one indexed query against
// a partial index over pending rows, and an empty result ends the request.
//
// The tick re-validates every row before sending — see runAutoSendTick. Nothing
// here decides whether a send is appropriate; this route only supplies the clock.
//
// GET delegates to POST so it's easy to fire manually by visiting the URL.

export const maxDuration = 60;

export async function POST(request: Request) {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  const now = new Date();
  const results = await runAutoSendTick(now);
  return NextResponse.json({
    ran_at: now.toISOString(),
    due_considered: results.length,
    sent: results.filter((r) => r.status === 'sent').length,
    cancelled: results.filter((r) => r.status === 'cancelled').length,
    failed: results.filter((r) => r.status === 'failed').length,
    results,
  });
}

export async function GET(request: Request) {
  return POST(request);
}
