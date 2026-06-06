import { NextResponse } from 'next/server';
import { backfillKnownConversations } from '@/src/server/messages/ingest';

// Re-sync the full thread (both directions) of every known conversation. Catches
// host replies that arrive with no subsequent inbound guest message — those
// never trigger the webhook. Runs on a cron and is manually triggerable in a
// browser (GET), mirroring /api/hostaway/sync.
export const maxDuration = 300;

export async function POST() {
  try {
    const result = await backfillKnownConversations();
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
