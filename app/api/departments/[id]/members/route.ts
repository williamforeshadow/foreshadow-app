import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { getCurrentAppUser } from '@/src/server/users/currentUser';

// Department membership writes (user_departments join table). Add/remove are
// immediate single-row actions, so this is a dedicated nested route rather than
// a full-list replace. Both handlers are gated to superadmin/manager; reads of
// membership live on the parent GET /api/departments/[id].

// Resolve the signed-in user and confirm they may manage members.
async function requireManager() {
  const { user, error } = await getCurrentAppUser();
  if (error === 'unauthenticated') {
    return { error: NextResponse.json({ error: 'Not signed in' }, { status: 401 }) };
  }
  if (user?.role !== 'superadmin' && user?.role !== 'manager') {
    return { error: NextResponse.json({ error: 'Not allowed' }, { status: 403 }) };
  }
  return { user };
}

// POST /api/departments/[id]/members  { user_id } — add a member (idempotent).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireManager();
  if (gate.error) return gate.error;

  try {
    const { id } = await params;
    const body = await request.json();
    const userId = typeof body.user_id === 'string' ? body.user_id.trim() : '';
    if (!userId) {
      return NextResponse.json({ error: 'A user_id is required' }, { status: 400 });
    }

    // upsert so re-adding an existing member is a no-op, not a 23505 error.
    const { error } = await getSupabaseServer()
      .from('user_departments')
      .upsert({ user_id: userId, department_id: id }, { onConflict: 'user_id,department_id' });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to add member';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/departments/[id]/members?user_id=... — remove a member (no-op if
// they aren't one).
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireManager();
  if (gate.error) return gate.error;

  try {
    const { id } = await params;
    const userId = request.nextUrl.searchParams.get('user_id')?.trim() ?? '';
    if (!userId) {
      return NextResponse.json({ error: 'A user_id is required' }, { status: 400 });
    }

    const { error } = await getSupabaseServer()
      .from('user_departments')
      .delete()
      .eq('department_id', id)
      .eq('user_id', userId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to remove member';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
