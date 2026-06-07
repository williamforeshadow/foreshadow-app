import { NextResponse } from 'next/server';
import { backfillRecentConversations } from '@/src/server/messages/ingest';

// One-time backfill: build canonical `conversations` rows for every existing
// thread (recent Hostaway conversations + all known). Large cap to cover all.
// Manually triggerable (GET) like /api/hostaway/sync.
export const maxDuration = 300;

export async function POST() {
  try {
    const result = await backfillRecentConversations(10000);
    return NextResponse.json({ success: true, ...result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Backfill Conversations] Error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  return POST();
}
