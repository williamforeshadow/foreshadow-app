import { NextResponse } from 'next/server';

// Shared-secret guard for the scheduled + administrative routes (the Vercel
// crons and the manual backfills).
//
// These run on the service-role client and have destructive side effects —
// /api/hostaway/sync deletes reservations, /api/hostaway/calendar-sync deletes
// calendar_blocks — yet they carry no session and proxy.ts deliberately lets
// every /api path through ungated. They're also invoked by GET (Vercel Cron's
// method), so anything that merely FOLLOWS a URL can fire them: a crawler, a
// chat link unfurl, a browser prefetch. The realistic failure mode here isn't an
// attacker, it's a bot.
//
// Integration: Vercel Cron automatically sends `Authorization: Bearer
// $CRON_SECRET` on every cron invocation when CRON_SECRET is set on the project,
// so setting that one env var is the entire wiring. Manual runs pass the same
// header:  curl -X POST -H "Authorization: Bearer $CRON_SECRET" <url>
//
// FAILS CLOSED when CRON_SECRET is unset: an unset secret must never read as
// "open to everyone" — that's the exact hole this closes. Mirrors the
// HOSTAWAY_WEBHOOK_SECRET receiver, which also refuses rather than leave an open
// ingest URL. Consequence: set CRON_SECRET in the environment BEFORE deploying
// this, or the crons will 503 until you do.

export function requireCronAuth(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error(
      '[cron auth] CRON_SECRET is not set — refusing to run a service-role job on an unauthenticated request.',
    );
    return NextResponse.json({ error: 'This endpoint is not configured' }, { status: 503 });
  }

  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}
