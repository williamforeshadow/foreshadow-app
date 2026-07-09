import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { requireAuthContext } from '@/lib/requireAuthContext';
import {
  confirmPendingAction,
  cancelPendingAction,
} from '@/src/server/agent/pendingActions';

// POST /api/agent/confirm
//
// Commits or cancels writes the in-app chat previewed. /api/agent returns
// `pending_action_ids: string[]` whenever any preview tools registered
// durable actions; the chat renders ONE Confirm/Cancel pair from the
// array, and a click lands here. We loop the array in registration order
// and aggregate the per-action results into a single response — so a
// single click commits (or cancels) every preview from the turn
// atomically from the user's perspective.
//
// Backward compat: also accepts legacy singular `pending_action_id` from
// any caller still on the old shape; we normalize to a single-element
// array internally.
//
// Partial-failure policy: continue past failures, report which committed
// and which failed in the response text. Each action was independently
// previewed and the user OK'd them as a group — aborting the rest on
// one failure would hide successful changes that already landed.

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

interface PerActionResult {
  id: string;
  ok: boolean;
  status: string;
  text: string;
}

function aggregate(
  results: PerActionResult[],
  action: 'confirm' | 'cancel',
): { ok: boolean; status: string; text: string } {
  // Single-action: pass through verbatim so the existing single-preview
  // UX is byte-identical.
  if (results.length === 1) {
    const r = results[0];
    return { ok: r.ok, status: r.status, text: r.text };
  }

  const succeeded = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const successVerb = action === 'confirm' ? 'Committed' : 'Cancelled';

  const parts: string[] = [];
  if (succeeded.length > 0) {
    parts.push(`${successVerb} ${succeeded.length} of ${results.length}:`);
    for (const r of succeeded) parts.push(`* ${r.text}`);
  }
  if (failed.length > 0) {
    if (parts.length > 0) parts.push('');
    parts.push(`Failed ${failed.length}:`);
    for (const r of failed) parts.push(`* ${r.text}`);
  }

  // Status: if anything succeeded use the same status the single-action
  // path would have returned (so the client's 'done' / 'cancelled' state
  // mapping still applies). Only mark as error when ALL actions failed.
  const allFailed = succeeded.length === 0;
  const overallStatus = allFailed
    ? 'error'
    : action === 'confirm'
      ? 'committed'
      : 'cancelled';

  return {
    ok: succeeded.length > 0,
    status: overallStatus,
    text: parts.join('\n'),
  };
}

export async function POST(req: NextRequest) {
  let actionIds: string[];
  let action: 'confirm' | 'cancel';
  try {
    const body = await req.json();
    // Accept the new array shape OR the legacy singular field.
    const rawArray = body?.pending_action_ids;
    const rawSingular = body?.pending_action_id;
    if (Array.isArray(rawArray)) {
      actionIds = rawArray.filter(
        (v): v is string => typeof v === 'string' && v.length > 0,
      );
    } else if (typeof rawSingular === 'string' && rawSingular.length > 0) {
      actionIds = [rawSingular];
    } else {
      actionIds = [];
    }
    action = body?.action;
    // NOTE: body.user_id is intentionally IGNORED — the actor comes from the
    // verified session. A client-supplied id let a caller confirm/cancel
    // another user's pending writes.
    if (actionIds.length === 0) {
      return NextResponse.json(
        { error: 'Missing or invalid pending_action_ids' },
        { status: 400 },
      );
    }
    if (action !== 'confirm' && action !== 'cancel') {
      return NextResponse.json(
        { error: 'action must be "confirm" or "cancel"' },
        { status: 400 },
      );
    }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Verified session identity — confirmPendingAction additionally enforces
  // that this user owns each pending action.
  const authCtx = await requireAuthContext();
  if (authCtx instanceof NextResponse) return authCtx;
  const userId = authCtx.appUser.id;

  const supabase = getSupabaseServer();

  // Loop through the actions in the order the previews were registered.
  // Continue past failures so a single bad apple doesn't strand the rest
  // (the user OK'd the bundle, not each one individually).
  const results: PerActionResult[] = [];
  for (const id of actionIds) {
    const raw =
      action === 'confirm'
        ? await confirmPendingAction({ actionId: id, appUserId: userId })
        : await cancelPendingAction({ actionId: id, appUserId: userId });
    results.push({
      id,
      ok: raw.ok,
      status: raw.status,
      text: slackLinksToMarkdown(raw.text),
    });
  }

  const combined = aggregate(results, action);

  // Persist the outcome so the next agent turn sees it. One user row and
  // one assistant row per bundle (not per action) keeps history compact
  // and matches what the user clicked.
  await supabase.from('ai_chat_messages').insert({
    user_id: userId,
    role: 'user',
    content: action === 'confirm' ? 'Confirmed.' : 'Cancelled.',
    metadata: { pending_action_ids: actionIds },
  });
  await supabase.from('ai_chat_messages').insert({
    user_id: userId,
    role: 'assistant',
    content: combined.text,
    metadata: {
      pending_action_ids: actionIds,
      pending_action_results: results.map((r) => ({
        id: r.id,
        status: r.status,
        ok: r.ok,
      })),
    },
  });

  return NextResponse.json({
    ok: combined.ok,
    status: combined.status,
    text: combined.text,
    results,
  });
}
