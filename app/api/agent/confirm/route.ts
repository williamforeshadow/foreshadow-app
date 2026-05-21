import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import {
  confirmPendingAction,
  cancelPendingAction,
} from '@/src/server/agent/pendingActions';

// POST /api/agent/confirm
//
// Commits or cancels a write the in-app chat previewed. /api/agent returns a
// `pending_action_id` whenever a preview tool registered a durable action;
// the chat renders Confirm/Cancel buttons from it, and a click lands here.
// The frozen plan executes server-side via confirmPendingAction — no second
// LLM turn, and the committed plan is exactly what the user saw.

// The pending-action executors emit Slack-flavored links (<url|label>) since
// Slack was the original surface. Rewrite them to markdown so the web chat
// renders them as real links. The url may be absolute (https://…, when
// APP_BASE_URL is set) or a relative app path (/tasks/…).
function slackLinksToMarkdown(text: string): string {
  return text.replace(
    /<((?:https?:\/\/|\/)[^|>]+)\|([^>]+)>/g,
    '[$2]($1)',
  );
}

export async function POST(req: NextRequest) {
  let pendingActionId: string;
  let action: 'confirm' | 'cancel';
  let userId: string;
  try {
    const body = await req.json();
    pendingActionId = body?.pending_action_id;
    action = body?.action;
    userId = body?.user_id;
    if (!pendingActionId || typeof pendingActionId !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid pending_action_id' },
        { status: 400 },
      );
    }
    if (action !== 'confirm' && action !== 'cancel') {
      return NextResponse.json(
        { error: 'action must be "confirm" or "cancel"' },
        { status: 400 },
      );
    }
    if (!userId || typeof userId !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid user_id' },
        { status: 400 },
      );
    }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const supabase = getSupabaseServer();

  // Resolve the actor — the same identity the in-app chat runs the agent as.
  // confirmPendingAction enforces that this user owns the pending action.
  const { data: userRow } = await supabase
    .from('users')
    .select('id')
    .eq('id', userId)
    .maybeSingle();
  if (!userRow?.id) {
    return NextResponse.json({ error: 'Unknown user' }, { status: 401 });
  }

  const result =
    action === 'confirm'
      ? await confirmPendingAction({ actionId: pendingActionId, appUserId: userId })
      : await cancelPendingAction({ actionId: pendingActionId, appUserId: userId });

  const text = slackLinksToMarkdown(result.text);

  // Persist the outcome so the next agent turn sees it. The user row keeps
  // ai_chat_messages role-alternating (the prior assistant row was the plan);
  // the assistant row carries the result narrative.
  await supabase.from('ai_chat_messages').insert({
    user_id: userId,
    role: 'user',
    content: action === 'confirm' ? 'Confirmed.' : 'Cancelled.',
    metadata: { pending_action_id: pendingActionId },
  });
  await supabase.from('ai_chat_messages').insert({
    user_id: userId,
    role: 'assistant',
    content: text,
    metadata: {
      pending_action_id: pendingActionId,
      pending_action_status: result.status,
    },
  });

  return NextResponse.json({ ok: result.ok, status: result.status, text });
}
