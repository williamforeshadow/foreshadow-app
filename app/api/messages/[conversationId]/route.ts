import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { getCurrentAppUser } from '@/src/server/users/currentUser';

// Thread for one conversation: the conversation header + its messages (oldest
// first), for the detail view.
export async function GET(
  _request: Request,
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
  const supabase = getSupabaseServer();

  const { data: conversation, error: convError } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', conversationId)
    .maybeSingle();
  if (convError) {
    return NextResponse.json({ error: convError.message }, { status: 500 });
  }
  if (!conversation) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { data: messages, error: msgError } = await supabase
    .from('guest_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('sent_at', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: true });
  if (msgError) {
    return NextResponse.json({ error: msgError.message }, { status: 500 });
  }

  return NextResponse.json({ conversation, messages: messages ?? [] });
}
