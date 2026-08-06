import { NextRequest, NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/requireAuthContext';
import { loadSessionMessages } from '@/src/server/agent/sessions';

// GET /api/agent/sessions/[id]/messages
//
// Rehydrates a session's transcript. Before this existed the server had been
// remembering conversations the browser threw away on every refresh — the user
// lost the thread, the agent didn't. This closes that gap from the other side.

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authCtx = await requireAuthContext();
  if (authCtx instanceof NextResponse) return authCtx;
  const { id } = await params;

  const messages = await loadSessionMessages(authCtx.appUser.id, id);
  if (messages === null) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  return NextResponse.json({ messages });
}
