import { NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/requireCronAuth';
import { runEmbeddingSweep, type SweepMode } from '@/src/server/search/sweep';

// POST /api/cron/embeddings[?mode=full]
//
// Keeps search_embeddings in agreement with the source rows. Two cadences, the
// same split this repo already runs for messages (a frequent poll plus an hourly
// backfill that catches whatever the poll's window missed):
//
//   */5 * * * *   incremental — only rows changed in the last 2 days
//   40  * * * *   full        — no window at all; the self-healing pass
//
// Same predicate either way; the window is purely a cost bound. See
// src/server/search/sweep.ts and the header of the 20260804120000 migration.
//
// The 60s ceiling is not a correctness constraint here: the sweep has no cursor,
// so a tick that runs out of budget just leaves the remainder queued.

export const maxDuration = 60;

export async function POST(request: Request) {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  const mode: SweepMode =
    new URL(request.url).searchParams.get('mode') === 'full' ? 'full' : 'incremental';

  try {
    const result = await runEmbeddingSweep({ mode });
    // A missing OPENAI_API_KEY is an unconfigured optional feature, not a
    // failure — 200 with a skip marker, matching the shape
    // app/api/hostaway/messages/backfill/route.ts uses for a missing
    // integration. (requireCronAuth's 503 is different: that one guards a
    // security boundary and SHOULD page someone.)
    if (result.stopped_reason === 'no_api_key') {
      return NextResponse.json({ success: true, skipped: 'no_api_key' });
    }
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'embedding sweep failed';
    console.error('[cron/embeddings] sweep failed', { mode, error: message });
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// Vercel Cron issues GET; delegating also makes manual firing by URL easy.
export async function GET(request: Request) {
  return POST(request);
}
