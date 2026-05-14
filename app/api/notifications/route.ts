import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { getCurrentAppUser } from '@/src/server/users/currentUser';

export async function GET(request: Request) {
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

  const { searchParams } = new URL(request.url);
  const view = searchParams.get('view') === 'all' ? 'all' : 'unread';
  const limit = Math.min(Number(searchParams.get('limit') ?? 50) || 50, 100);

  let query = getSupabaseServer()
    .from('notifications')
    .select('*, actor:users!actor_user_id(id, name)')
    .eq('user_id', user.id)
    .eq('native_visible', true)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (view === 'unread') {
    query = query.is('read_at', null);
  }

  const [{ data, error: listError }, unreadCount] = await Promise.all([
    query,
    getSupabaseServer()
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('native_visible', true)
      .is('read_at', null),
  ]);

  if (listError) {
    return NextResponse.json({ error: listError.message }, { status: 500 });
  }

  const notifications = (data ?? []).map((row: { actor?: { name?: string | null } | null } & Record<string, unknown>) => {
    const { actor, ...rest } = row;
    return { ...rest, actor_name: actor?.name ?? null };
  });

  return NextResponse.json({
    notifications,
    unread_count: unreadCount.count ?? 0,
  });
}
