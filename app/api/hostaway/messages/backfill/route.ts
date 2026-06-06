import { NextResponse } from 'next/server';
import { backfillRecentConversations } from '@/src/server/messages/ingest';

// Discover + re-sync recent conversations (incl. inquiry threads with no booked
// reservation) and every known thread. Catches host replies that arrive with no
// following inbound (those never webhook) and inquiry threads that never match a
// synced reservation. Runs on a cron and is manually triggerable (GET), mirroring
// /api/hostaway/sync.
export const maxDuration = 300;

export async function POST() {
  try {
    const result = await backfillRecentConversations();
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
