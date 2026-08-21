import { NextRequest, NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/requireAuthContext';
import { loadProposedKnowledgeCards } from '@/src/server/agent/proposedKnowledgeCards';

// GET /api/proposed-knowledge?ids=<uuid>,<uuid>
//
// Card-shaped knowledge-proposal rows by id. The agent chat panel calls this
// after a Save/Dismiss to swap a bubble for its authoritative post-decision
// state (tombstone with decider + deep link). Session client, so RLS keeps it
// org-scoped. Mirrors GET /api/proposed-tasks.

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
    return NextResponse.json({ proposed_knowledge: [] });
  }

  const cards = await loadProposedKnowledgeCards(authCtx.supabase, ids);
  return NextResponse.json({ proposed_knowledge: cards });
}
