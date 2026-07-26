import { NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/requireCronAuth';
import { backfillRecentConversations } from '@/src/server/messages/ingest';
import { getPrimaryHostawayIntegration, hostawayCredsFor } from '@/lib/pmsIntegrations';

// Discover + re-sync recent conversations (incl. inquiry threads with no booked
// reservation) and every known thread. Runs on a cron and is manually
// triggerable (GET), mirroring /api/hostaway/sync.
//
// This used to be the ONLY thing that noticed a host reply sent outside the app
// (those never webhook), which is why it ran every 30 minutes. That job now
// belongs to /api/hostaway/messages/poll, which catches the same change within a
// minute for one list call instead of 150 thread pulls. So this is now the
// hourly SWEEP: it covers what the poll's 30-conversation scan window does not —
// threads with no recent host activity, and anything the poll deferred or
// failed on — and it stays the backstop if the poll is ever wedged.
export const maxDuration = 300;

export async function POST(request: Request) {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  try {
    // Cap covers the full inbox (currently ~108 threads) so every thread's
    // status mirrors the PMS each cycle, not just the most recent 80.
    // ~1.5s/thread (the Hostaway rate-limit sleep dominates), so 150 stays well
    // within maxDuration (300s). Revisit — paginate or refresh incrementally —
    // before the inbox approaches ~180 threads.
    const integration = await getPrimaryHostawayIntegration();
    if (!integration) {
      return NextResponse.json({ success: true, skipped: 'no_integration' });
    }
    const ctx = { creds: hostawayCredsFor(integration), orgId: integration.org_id };
    const result = await backfillRecentConversations(ctx, 150);
    return NextResponse.json({ success: true, ...result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Hostaway Messages Backfill] Error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
