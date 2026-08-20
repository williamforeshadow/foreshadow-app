import { NextRequest, NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/requireAuthContext';
import { loadProposedTaskCards } from '@/src/server/agent/proposedTaskCards';

// GET /api/proposed-tasks?ids=<uuid>,<uuid>
//
// Card-shaped proposal rows by id. The agent chat panel calls this after an
// accept/dismiss to swap a card for its authoritative post-decision state
// (tombstone with decider + task link) without reloading the transcript.
// Runs on the session client, so RLS keeps it org-scoped.

const MAX_IDS = 50;

export async function GET(req: NextRequest) {
  const authCtx = await requireAuthContext();
  if (authCtx instanceof NextResponse) return authCtx;

  const raw = req.nextUrl.searchParams.get('ids') ?? '';
  const ids = raw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, MAX_IDS);
  if (ids.length === 0) {
    return NextResponse.json({ proposed_tasks: [] });
  }

  const cards = await loadProposedTaskCards(authCtx.supabase, ids);
  return NextResponse.json({ proposed_tasks: cards });
}
