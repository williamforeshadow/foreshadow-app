import { getSupabaseServer } from '@/lib/supabaseServer';

// "What is the newest message actually in this thread?" — the shared primitive
// behind every staleness question the concierge asks.
//
// Lives in its own module rather than in proposedReply because four callers now
// need it (proposedReply, proposedTask, proposedKnowledge, conversationSentiment)
// and autoSend makes a fifth. autoSend is imported BY proposedReply, so reaching
// back into proposedReply for this would close an import cycle.
//
// Future-dated rows are excluded deliberately: Hostaway automations appear in
// the thread with a `sent_at` in the future, and treating one as "the latest
// message" would make a draft look answered by something that hasn't gone out.

export interface LatestSent {
  id: string;
  direction: 'inbound' | 'outbound';
}

/** The latest actually-sent message in a conversation (future-dated automations excluded). */
export async function getLatestSentMessage(conversationId: string): Promise<LatestSent | null> {
  const nowIso = new Date().toISOString();
  const { data, error } = await getSupabaseServer()
    .from('guest_messages')
    .select('id, direction, sent_at')
    .eq('conversation_id', conversationId)
    .or(`sent_at.is.null,sent_at.lte.${nowIso}`)
    .order('sent_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const row = (data ?? [])[0] as { id: string; direction: 'inbound' | 'outbound' } | undefined;
  return row ? { id: row.id, direction: row.direction } : null;
}
