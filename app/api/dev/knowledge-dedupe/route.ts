import { NextResponse } from 'next/server';
import {
  generateProposedKnowledge,
  loadKnowledgeContext,
  loadProposalDigests,
} from '@/src/server/messages/draftKnowledge';

// Dev-only inspection seam for the knowledge-triage prompt.
//
// Whether a proposal duplicates something already known is decided by the model,
// from three blocks in its prompt: the property's current knowledge, proposals
// awaiting review, and proposals the team rejected. Those blocks are the entire
// mechanism, and they are invisible from the outside — the bug this fixed was a
// block that listed titles without their values, which no amount of staring at
// the output would reveal. So:
//
//  - `blocks` renders exactly what the model will be told the property knows.
//  - `triage` runs the real generator over a real conversation and returns what it
//    WOULD propose, storing nothing and notifying nobody — so a thread that used
//    to produce a duplicate can be replayed to prove it no longer does.
//
// Same shape and the same production guard as /api/dev/pk-ops. It performs no auth
// on purpose (it drives the services directly) and returns full property
// knowledge including codes and credentials — which is exactly why it must never
// be reachable in production.

export const maxDuration = 60;

function devGuard(): NextResponse | null {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'The knowledge-triage inspector is disabled in production.' },
      { status: 403 },
    );
  }
  return null;
}

export async function POST(req: Request) {
  const blocked = devGuard();
  if (blocked) return blocked;

  let body: { mode?: string; property_id?: string; conversation_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { mode = 'blocks', property_id: propertyId, conversation_id: conversationId } = body;

  // `triage` is keyed on the conversation, not the property — it resolves its own
  // context. Nothing is written: this is generate-only, the store/notify step
  // lives in proposedKnowledge.ts and is deliberately not called here.
  if (mode === 'triage') {
    if (!conversationId) {
      return NextResponse.json({ error: 'triage requires conversation_id' }, { status: 400 });
    }
    try {
      const result = await generateProposedKnowledge(conversationId);
      return NextResponse.json({
        proposal_count: result.proposals.length,
        reasoning: result.reasoning,
        proposals: result.proposals.map((p) => ({
          summary: p.summary,
          guest_visible: p.guest_visible,
          reasoning: p.reasoning,
          target: p.target,
        })),
      });
    } catch (err) {
      return NextResponse.json(
        { ok: false, threw: true, error: err instanceof Error ? err.message : String(err) },
        { status: 200 },
      );
    }
  }

  if (!propertyId) {
    return NextResponse.json({ error: 'property_id is required' }, { status: 400 });
  }

  try {
    const [context, digests] = await Promise.all([
      loadKnowledgeContext(propertyId),
      loadProposalDigests(propertyId, conversationId ?? ''),
    ]);
    return NextResponse.json({
      knowledge_block: context.block,
      pending: digests.pending,
      rejected: digests.rejected,
      counts: {
        rooms: context.rooms.length,
        policies: context.policies.length,
        pending: digests.pending.length,
        rejected: digests.rejected.length,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        threw: true,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 200 },
    );
  }
}
