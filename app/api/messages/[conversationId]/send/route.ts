import { NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/requireAuthContext';
import {
  sendGuestMessage,
  type SendFailureCode,
} from '@/src/server/messages/sendGuestMessage';
import { cancelAutoSend } from '@/src/server/messages/autoSend';

export const maxDuration = 60;

// HTTP status per failure code. Keeps the wire contract identical to the
// pre-extraction handler — the send mechanics moved to sendGuestMessage.ts, the
// status mapping stayed here where it belongs.
const STATUS_BY_CODE: Record<SendFailureCode, number> = {
  invalid_body: 400,
  not_found: 404,
  unsupported_source: 400,
  not_linked: 400,
  no_integration: 400,
  lookup_failed: 500,
  send_failed: 502,
};

// POST /api/messages/[conversationId]/send — send a host reply to the guest
// through the PMS. Drafting is elsewhere; this is the actual, human-confirmed
// send. The mechanics live in sendGuestMessage() so the auto-send cron reaches
// the guest by the exact same path; this route is the human half — session auth,
// RLS authorization, and HTTP shape.
export async function POST(
  request: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  const ctx = await requireAuthContext();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, appUser } = ctx;

  const { conversationId } = await context.params;

  let payload: { body?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const text = typeof payload.body === 'string' ? payload.body.trim() : '';
  if (!text) {
    return NextResponse.json({ error: 'Message body is required' }, { status: 400 });
  }

  // Authorize via the RLS-governed user client — another org's id reads as
  // absent (404). The send itself then runs on the service client inside
  // sendGuestMessage.
  const { data: conv, error: convErr } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', conversationId)
    .maybeSingle();
  if (convErr) {
    return NextResponse.json({ error: convErr.message }, { status: 500 });
  }
  if (!conv) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const result = await sendGuestMessage({
    conversationId,
    text,
    actor: { type: 'human', userId: appUser.id },
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: STATUS_BY_CODE[result.code] });
  }

  // A human just answered this thread, so any armed auto-send is moot — the
  // reply it was going to send has been superseded by this one. Best-effort:
  // never fail a delivered send on bookkeeping.
  try {
    await cancelAutoSend(conversationId, 'human_sent');
  } catch (err) {
    console.error('[messages send] auto-send cancel failed', { conversationId, err });
  }

  return NextResponse.json({ ok: true, message_id: result.messageId, sent_at: result.sentAt });
}
