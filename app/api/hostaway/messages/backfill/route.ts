import { NextResponse } from 'next/server';
import { backfillRecentConversations } from '@/src/server/messages/ingest';
import { getPrimaryHostawayIntegration, hostawayCredsFor } from '@/lib/pmsIntegrations';

// Discover + re-sync recent conversations (incl. inquiry threads with no booked
// reservation) and every known thread. Catches host replies that arrive with no
// following inbound (those never webhook) and inquiry threads that never match a
// synced reservation. Runs on a cron and is manually triggerable (GET), mirroring
// /api/hostaway/sync.
export const maxDuration = 300;

export async function POST() {
  try {
    // Cap covers the full inbox (currently ~108 threads) so every thread's
    // status mirrors the PMS each 30-min cycle, not just the most recent 80.
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

export async function GET() {
  return POST();
}
