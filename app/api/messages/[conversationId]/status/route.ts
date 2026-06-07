import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { getCurrentAppUser } from '@/src/server/users/currentUser';

// Update a conversation's app state: app_status (active/complete), unread, or
// archived. Used by: open conversation -> mark read; Mark complete / Reopen;
// Mark read / unread.
export async function POST(
  request: Request,
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

  let body: { app_status?: unknown; unread?: unknown; archived?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.app_status === 'active' || body.app_status === 'complete') {
    patch.app_status = body.app_status;
  }
  if (typeof body.unread === 'boolean') patch.unread = body.unread;
  if (typeof body.archived === 'boolean') patch.archived = body.archived;

  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }

  const { error: updateError } = await getSupabaseServer()
    .from('conversations')
    .update(patch)
    .eq('id', conversationId);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
