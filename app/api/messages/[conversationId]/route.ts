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

  // The pending concierge-proposed task, if one was drafted from a recent guest
  // message. Surfaced as a bubble in the thread; null when there's none.
  const { data: proposedTaskRow } = await supabase
    .from('proposed_tasks')
    .select('id, title, description, priority, department_id, departments(name)')
    .eq('conversation_id', conversationId)
    .eq('status', 'pending')
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const proposed_task = proposedTaskRow
    ? {
        id: proposedTaskRow.id as string,
        title: (proposedTaskRow.title as string | null) ?? '',
        description: (proposedTaskRow.description as string | null) ?? null,
        priority: (proposedTaskRow.priority as string | null) ?? 'medium',
        department_name:
          ((proposedTaskRow.departments as { name: string | null } | null)?.name) ?? null,
      }
    : null;

  return NextResponse.json({ conversation, messages: messages ?? [], proposed_task });
}
