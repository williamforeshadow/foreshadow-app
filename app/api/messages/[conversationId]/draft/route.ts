import { NextResponse } from 'next/server';
import { getCurrentAppUser } from '@/src/server/users/currentUser';
import { generateAndStoreProposedReply } from '@/src/server/messages/proposedReply';

export const maxDuration = 60;

// POST /api/messages/[conversationId]/draft — (re)generate the conversation's
// proposed reply for the inbox. Runs the Concierge and PERSISTS the result on the
// conversation (source 'auto'), so the inbox reads one stored draft rather than
// regenerating on every open. Drafts only — nothing is sent.
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
    const { draft, answers_message_id } = await generateAndStoreProposedReply(
      conversationId,
      { source: 'auto' },
    );
    return NextResponse.json({ draft, answers_message_id });
  } catch (err) {
    console.error('[messages draft] generation failed:', err);
    const message = err instanceof Error ? err.message : 'Failed to draft a reply';
    const status = /not found/i.test(message) ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
