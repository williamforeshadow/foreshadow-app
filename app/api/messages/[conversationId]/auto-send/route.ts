import { NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/requireAuthContext';
import { cancelAutoSend, type AutoSendCancelReason } from '@/src/server/messages/autoSend';

// DELETE /api/messages/[conversationId]/auto-send — stand down the armed timer.
//
// Two callers, distinguished only by the recorded reason: the countdown's
// explicit "Cancel", and the proposed-reply "Edit" button (pulling the draft into
// the composer means the operator has taken the wheel, so the unattended send
// should not still be counting down behind them).
//
// Cancelling is idempotent — a thread with nothing pending returns ok. The UI
// fires this defensively and must not have to know whether a timer exists.

const ALLOWED_REASONS: AutoSendCancelReason[] = ['edited', 'operator_cancelled'];

export async function DELETE(
  request: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  const ctx = await requireAuthContext();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, appUser } = ctx;

  const { conversationId } = await context.params;

  // Authorize through RLS — another org's conversation reads as absent.
  const { data: conv, error: convErr } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', conversationId)
    .maybeSingle();
  if (convErr) return NextResponse.json({ error: convErr.message }, { status: 500 });
  if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const url = new URL(request.url);
  const requested = url.searchParams.get('reason');
  // A caller may only claim one of the human-intent reasons. Anything else is
  // recorded as a plain operator cancel rather than trusted — the reason column
  // is an audit field and shouldn't accept arbitrary strings off the wire.
  const reason: AutoSendCancelReason = ALLOWED_REASONS.includes(requested as AutoSendCancelReason)
    ? (requested as AutoSendCancelReason)
    : 'operator_cancelled';

  await cancelAutoSend(conversationId, reason, appUser.id);

  return NextResponse.json({ ok: true });
}
