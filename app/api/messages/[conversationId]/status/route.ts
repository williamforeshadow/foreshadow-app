import { NextResponse, after } from 'next/server';
import { requireAuthContext } from '@/lib/requireAuthContext';
import { maybeGenerateProposedKnowledgeForConversation } from '@/src/server/messages/proposedKnowledge';

// Update a conversation's app state: app_status (active/complete), unread, or
// archived. Used by: open conversation -> mark read; Mark complete / Reopen;
// Mark read / unread.
export async function POST(
  request: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  const ctx = await requireAuthContext();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;

  const { conversationId } = await context.params;

  let body: {
    app_status?: unknown;
    unread?: unknown;
    archived?: unknown;
    concierge_enabled?: unknown;
  };
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
  if (typeof body.concierge_enabled === 'boolean') {
    patch.concierge_enabled = body.concierge_enabled;
    // Turning the concierge OFF means a human is taking over this thread — clear
    // the standing AI draft so a stale proposal doesn't linger beneath it. (No
    // re-draft on turning back ON here; the next inbound or thread-open handles
    // that via the normal autonomous path.)
    if (body.concierge_enabled === false) {
      patch.proposed_reply = null;
      patch.proposed_reply_answers_message_id = null;
      patch.proposed_reply_source = null;
      patch.proposed_reply_generated_at = null;
      patch.proposed_reply_sources = null;
      patch.proposed_reply_declined_message_id = null;
    }
  }

  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }

  const { error: updateError } = await supabase
    .from('conversations')
    .update(patch)
    .eq('id', conversationId);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // Marking a conversation complete is a "settled" signal — run knowledge triage
  // over the whole thread (catches threads where the guest never replied to a
  // host info message). Off the response path, best-effort.
  if (patch.app_status === 'complete') {
    after(async () => {
      await maybeGenerateProposedKnowledgeForConversation(conversationId, {
        requireHostMessage: false,
      });
    });
  }

  return NextResponse.json({ ok: true });
}
