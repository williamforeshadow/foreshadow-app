import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { getCurrentAppUser } from '@/src/server/users/currentUser';
import { deriveReservationStatus, type ConversationTab } from '@/lib/conversations';
import { todayInTz, DEFAULT_TIMEZONE } from '@/src/lib/dates';

// Conversation inbox list. Workspace-global (any authed manager). Server-side
// tab + sort; the 6 filters are applied client-side over the loaded tab.
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
  const tab: ConversationTab =
    searchParams.get('tab') === 'complete' ? 'complete' : 'active';
  const ascending = searchParams.get('sort') === 'oldest';

  const supabase = getSupabaseServer();

  const [{ data, error: listError }, activeCount, completeCount, unreadCount] =
    await Promise.all([
      supabase
        .from('conversations')
        .select('*')
        .eq('archived', false)
        .eq('app_status', tab)
        .order('last_message_at', { ascending, nullsFirst: false })
        .limit(500),
      supabase
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('archived', false)
        .eq('app_status', 'active'),
      supabase
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('archived', false)
        .eq('app_status', 'complete'),
      supabase
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('archived', false)
        .eq('app_status', 'active')
        .eq('unread', true),
    ]);

  if (listError) {
    return NextResponse.json({ error: listError.message }, { status: 500 });
  }

  const { date: today } = todayInTz(DEFAULT_TIMEZONE);
  const conversations = (data ?? []).map(
    (c: Record<string, unknown>) => ({
      ...c,
      reservation_status: deriveReservationStatus(
        c.booking_state as 'inquiry' | 'booked' | 'cancelled',
        (c.check_in as string | null) ?? null,
        (c.check_out as string | null) ?? null,
        today,
      ),
    }),
  );

  return NextResponse.json({
    conversations,
    counts: {
      active: activeCount.count ?? 0,
      complete: completeCount.count ?? 0,
      unread: unreadCount.count ?? 0,
    },
  });
}
