import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { getCurrentAppUser } from '@/src/server/users/currentUser';
import { groupMessagesIntoConversations } from '@/lib/messages';

// Read route for the Messages inbox. Workspace-global: any authed manager sees
// all guest messages (no per-user filter). Returns messages grouped into
// conversation threads (one row per conversation). Mirrors the auth +
// service-role pattern of app/api/notifications/route.ts.
export async function GET() {
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

  // Pull recent messages, then group into threads in app code. Grab a generous
  // window so a conversation's older messages aren't split across the cutoff.
  const { data, error: listError } = await getSupabaseServer()
    .from('guest_messages')
    .select('*')
    .order('sent_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1000);

  if (listError) {
    return NextResponse.json({ error: listError.message }, { status: 500 });
  }

  const conversations = groupMessagesIntoConversations(data ?? []);
  return NextResponse.json({ conversations });
}
