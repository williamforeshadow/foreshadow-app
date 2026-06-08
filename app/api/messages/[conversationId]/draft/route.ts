import { NextResponse } from 'next/server';
import { getCurrentAppUser } from '@/src/server/users/currentUser';
import { generateGuestReplyDraft } from '@/src/server/messages/draftReply';

export const maxDuration = 60;

// POST /api/messages/[conversationId]/draft — generate an AI reply draft for the
// inbox composer's "AI draft" button. Default context (thread + reservation);
// the richer, property-aware path is the agent's draft_guest_reply tool. Drafts
// only — nothing is sent.
export async function POST(
  _request: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  const { user, error } = await getCurrentAppUser();
  if (error === 'unauthenticated') {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }
  if (error === 'unlinked' || !user) {
    return NextResponse.json(
      { error: 'No Foreshadow profile is linked to this account' },
      { status: 403 },
    );
  }

  const { conversationId } = await context.params;

  try {
    const { draft } = await generateGuestReplyDraft({ conversationId });
    return NextResponse.json({ draft });
  } catch (err) {
    console.error('[messages draft] generation failed:', err);
    const message = err instanceof Error ? err.message : 'Failed to draft a reply';
    const status = /not found/i.test(message) ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
