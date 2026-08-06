import { NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/requireAuthContext';
import { listWebSessions } from '@/src/server/agent/sessions';

// GET /api/agent/sessions
//
// The signed-in user's web chat sessions, newest activity first. Slack
// sessions never appear — see src/server/agent/sessions.ts.
//
// There is no POST. "New chat" is purely local state in the client: the
// session row is created by the first /api/agent call and comes back on that
// response. Creating one up front would litter the list with empty, untitled
// sessions for every stray Cmd+K.

export async function GET() {
  const authCtx = await requireAuthContext();
  if (authCtx instanceof NextResponse) return authCtx;

  const sessions = await listWebSessions(authCtx.appUser.id);
  return NextResponse.json({ sessions });
}
