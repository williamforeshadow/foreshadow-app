import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentAppUser } from '@/src/server/users/currentUser';
import {
  structureTrainingFromNote,
  structureTrainingFromConversation,
} from '@/src/server/messages/draftTrainingBlock';

// POST /api/concierge-training/structure — AI-assisted authoring. Turns either a
// plain-language note or a selected conversation excerpt into a structured
// training-block DRAFT for the operator to review. This never writes to the DB;
// the reviewed draft is saved via POST /api/concierge-training (or appended to an
// existing block via POST /api/concierge-training/[id]/examples).

export const maxDuration = 60; // the structuring call is a model round-trip

export async function POST(request: NextRequest) {
  const { error: authError } = await getCurrentAppUser();
  if (authError === 'unauthenticated') {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const source = body.source;
  const result =
    source === 'conversation'
      ? await structureTrainingFromConversation({
          conversationId: typeof body.conversation_id === 'string' ? body.conversation_id : '',
          messageIds: Array.isArray(body.message_ids)
            ? (body.message_ids as unknown[]).filter((m): m is string => typeof m === 'string')
            : [],
        })
      : source === 'note'
        ? await structureTrainingFromNote(typeof body.note === 'string' ? body.note : '')
        : null;

  if (!result) {
    return NextResponse.json(
      { error: "source must be 'note' or 'conversation'" },
      { status: 400 },
    );
  }
  if (!result.ok) {
    const status = result.error.code === 'not_found' ? 404 : result.error.code === 'invalid_input' ? 400 : 500;
    return NextResponse.json({ error: result.error.message }, { status });
  }

  return NextResponse.json({ draft: result.data });
}
