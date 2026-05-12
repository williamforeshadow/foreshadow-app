import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { getCurrentAppUser } from '@/src/server/users/currentUser';

export async function POST(request: Request) {
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

  const body = await request.json().catch(() => ({}));
  const now = new Date().toISOString();
  let query = getSupabaseServer()
    .from('notifications')
    .update({ read_at: now, updated_at: now })
    .eq('user_id', user.id)
    .eq('native_visible', true)
    .is('read_at', null);

  if (Array.isArray(body?.ids) && body.ids.length > 0) {
    const ids = body.ids.filter((id: unknown): id is string => typeof id === 'string');
    query = query.in('id', ids);
  } else if (!body?.all) {
    return NextResponse.json(
      { error: 'Pass ids or all=true to mark notifications read' },
      { status: 400 },
    );
  }

  const { error: updateError } = await query;
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
