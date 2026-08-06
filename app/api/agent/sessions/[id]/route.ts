import { NextRequest, NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/requireAuthContext';
import {
  archiveWebSession,
  renameWebSession,
} from '@/src/server/agent/sessions';

// PATCH  /api/agent/sessions/[id]  — rename
// DELETE /api/agent/sessions/[id]  — archive (soft delete)
//
// Both refuse anything that isn't the caller's own live web session, and both
// answer 404 for "not yours" as well as "not there" so ids can't be probed.

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authCtx = await requireAuthContext();
  if (authCtx instanceof NextResponse) return authCtx;
  const { id } = await params;

  let title: string;
  try {
    const body = await req.json();
    if (typeof body?.title !== 'string') {
      return NextResponse.json(
        { error: 'title must be a string' },
        { status: 400 },
      );
    }
    title = body.title;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const ok = await renameWebSession(authCtx.appUser.id, id, title);
  if (!ok) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authCtx = await requireAuthContext();
  if (authCtx instanceof NextResponse) return authCtx;
  const { id } = await params;

  const ok = await archiveWebSession(authCtx.appUser.id, id);
  if (!ok) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
