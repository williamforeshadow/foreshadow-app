import { NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/requireAuthContext';
import {
  generateAndStoreProposedReply,
  maybeGenerateProposedReplyForConversation,
} from '@/src/server/messages/proposedReply';

export const maxDuration = 60;

// POST /api/messages/[conversationId]/draft — (re)generate the conversation's
// proposed reply for the inbox. Runs the Concierge and PERSISTS the result on the
// conversation (source 'auto'), so the inbox reads one stored draft rather than
// regenerating on every open. Drafts only — nothing is sent.
//
// Body: { auto?: boolean }
//   auto: true — the thread was opened with nothing drafted yet. NOBODY asked for
//                this, so it runs the full autonomous policy (master switch,
//                guest-awaiting, not-already-decided, sensitivity gate) and may
//                legitimately answer { skipped: true, reason }.
//   default    — a human clicked ↻ Regenerate or the composer's Sparkles.
//                Deliberately ungated: an explicit ask always drafts.
//
// The response carries `sources` alongside the draft rather than leaving the
// inbox to pick them up on its refetch. The bubble swaps in the new draft the
// moment this returns, so sources arriving a beat later would briefly caption a
// draft with the PREVIOUS generation's grounding.
export async function POST(
  request: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  const ctx = await requireAuthContext();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;

  const { conversationId } = await context.params;

  // Both paths generate via the service client, which bypasses RLS — so prove
  // the caller can reach this conversation first. This read is RLS-governed, so
  // another org's id reads as absent.
  const { data: conversation } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', conversationId)
    .maybeSingle();
  if (!conversation) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // No body at all (the ↻ and Sparkles buttons) reads as manual.
  const auto = await request
    .json()
    .then((body) => body?.auto === true)
    .catch(() => false);

  try {
    if (auto) {
      const outcome = await maybeGenerateProposedReplyForConversation(conversationId);
      if (outcome.status === 'skipped') {
        return NextResponse.json({ draft: '', skipped: true, reason: outcome.reason });
      }
      return NextResponse.json({
        draft: outcome.draft,
        answers_message_id: outcome.answers_message_id,
        sources: outcome.sources,
      });
    }

    const { draft, answers_message_id, sources } = await generateAndStoreProposedReply(
      conversationId,
      { source: 'auto' },
    );
    return NextResponse.json({ draft, answers_message_id, sources });
  } catch (err) {
    console.error('[messages draft] generation failed:', err);
    const message = err instanceof Error ? err.message : 'Failed to draft a reply';
    const status = /not found/i.test(message) ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
