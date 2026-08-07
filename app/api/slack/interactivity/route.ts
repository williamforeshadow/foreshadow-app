import { NextRequest, NextResponse, after } from 'next/server';
import { WebClient } from '@slack/web-api';
import { verifySlackSignature } from '@/src/slack/verify';
import {
  AGENT_CANCEL_ACTION_ID,
  AGENT_CONFIRM_ACTION_ID,
  cancelPendingAction,
  confirmPendingAction,
  loadPendingActionsByIds,
  setPendingActionMessageTs,
} from '@/src/server/agent/pendingActions';
import {
  blocksWithoutConfirmation,
  buildConfirmationBlocks,
  buildResultAttachments,
  decodePendingActionIds,
} from '@/src/server/agent/slackConfirmationBlocks';
import { maybeRunContinuation } from '@/src/server/agent/continuation';
import { appendMessage, resolveSlackSession } from '@/src/server/agent/memory';
import { markdownToMrkdwn } from '@/src/slack/format';
import {
  deleteNotificationSlackMessage,
  markNotificationRead,
} from '@/src/server/notifications/notify';

const NOTIFICATION_MARK_READ_PREFIX = 'notification_mark_read_';

// POST /api/slack/interactivity
//
// Slack posts every interactive click here as a form body with a JSON
// payload field. We verify the signature against the raw body, ack quickly,
// then process supported buttons in after() so Slack's 3-second deadline
// never blocks file uploads or database writes.
//
// Outcomes are recorded to the thread's agent session, same as the typed-"yes"
// path in the events route. They weren't, for a while: clicking Confirm
// committed and posted but persisted nothing, so the agent's next turn in that
// thread couldn't see what it had just done — while the web chat, which does
// record it, could. Same click, same conversation, same memory.

interface SlackInteractionPayload {
  type?: string;
  user?: { id?: string };
  channel?: { id?: string };
  message?: { ts?: string; thread_ts?: string; blocks?: unknown[] };
  actions?: Array<{ action_id?: string; value?: string }>;
}

export async function POST(req: NextRequest) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET ?? '';
  const botToken = process.env.SLACK_BOT_TOKEN ?? '';
  if (!signingSecret || !botToken) {
    console.error('[slack/interactivity] Slack env is not configured');
    return NextResponse.json(
      { error: 'Slack integration is not configured' },
      { status: 500 },
    );
  }

  const rawBody = await req.text();
  const verify = verifySlackSignature(
    rawBody,
    req.headers.get('x-slack-signature'),
    req.headers.get('x-slack-request-timestamp'),
    signingSecret,
  );
  if (!verify.ok) {
    console.warn('[slack/interactivity] signature verification failed', {
      reason: verify.reason,
    });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const payloadRaw = new URLSearchParams(rawBody).get('payload');
  if (payloadRaw) {
    after(async () => {
      try {
        const payload = JSON.parse(payloadRaw) as SlackInteractionPayload;
        await handleInteraction(payload, botToken);
      } catch (err) {
        console.error('[slack/interactivity] handler failed', { err });
      }
    });
  }

  return new NextResponse(null, { status: 200 });
}

async function handleInteraction(
  payload: SlackInteractionPayload,
  botToken: string,
): Promise<void> {
  if (payload.type !== 'block_actions') return;
  const action = payload.actions?.[0];
  const actionId = action?.action_id;

  if (actionId?.startsWith(NOTIFICATION_MARK_READ_PREFIX)) {
    const notificationId = actionId.slice(NOTIFICATION_MARK_READ_PREFIX.length);
    if (!notificationId) return;
    await markNotificationRead(notificationId);
    // Delete the original DM so the user's Slack inbox stays clean. The bell
    // still has the row (marked read). Best-effort — failures are logged.
    await deleteNotificationSlackMessage(notificationId);
    return;
  }

  if (
    actionId !== AGENT_CONFIRM_ACTION_ID &&
    actionId !== AGENT_CANCEL_ACTION_ID
  ) {
    return;
  }

  // Confirm/Cancel button value carries the ordered list of pending
  // action ids registered in the agent turn (comma-separated). One
  // click commits or cancels every preview from that turn atomically.
  const pendingActionIds = decodePendingActionIds(action?.value);
  const slackUserId = payload.user?.id;
  const channelId = payload.channel?.id;
  if (pendingActionIds.length === 0 || !slackUserId || !channelId) {
    console.warn('[slack/interactivity] missing action payload fields', {
      actionId,
      pendingActionIds,
      slackUserId,
      channelId,
    });
    return;
  }

  // Retire the buttons first, before any commit work: the click is already
  // irreversible at this point, and commits can take seconds. Leaving the pair
  // live in the meantime invites a second click and reads as "still waiting on
  // you". Best-effort — a failed update must not stop the commit.
  const web = new WebClient(botToken);
  const sourceTs = payload.message?.ts;
  if (sourceTs) {
    try {
      await web.chat.update({
        channel: channelId,
        ts: sourceTs,
        blocks: blocksWithoutConfirmation(
          payload.message?.blocks as never,
          actionId === AGENT_CONFIRM_ACTION_ID ? 'confirmed' : 'cancelled',
        ) as never,
      });
    } catch (err) {
      console.warn('[slack/interactivity] could not retire the buttons', { err });
    }
  }

  // Read the bundle BEFORE committing — the rows carry any follow-up the agent
  // registered and this turn's continuation depth, both stamped at preview time.
  const rows = await loadPendingActionsByIds(pendingActionIds);

  // Loop in registration order; continue on failure so a single bad
  // apple doesn't strand the rest of the bundle.
  const results: Array<{
    id: string;
    ok: boolean;
    text: string;
    forbidden: boolean;
  }> = [];
  for (const id of pendingActionIds) {
    const r =
      actionId === AGENT_CONFIRM_ACTION_ID
        ? await confirmPendingAction({ actionId: id, slackUserId })
        : await cancelPendingAction({ actionId: id, slackUserId });
    results.push({
      id,
      ok: r.ok,
      text: r.text,
      forbidden: r.error === 'forbidden',
    });
  }

  // Single-action: behavior unchanged (pass the raw text through; if it
  // was forbidden, post ephemeral as before). Multi-action: aggregate.
  const messageTs = payload.message?.thread_ts ?? payload.message?.ts;
  const threadTs = channelId.startsWith('D') ? undefined : messageTs;

  // Where to record the outcome. The pending-action rows are the authority on
  // which conversation this belongs to — they were stamped with the channel and
  // thread at preview time — so prefer them over the click payload, which
  // carries the bot's own message ts and would mint a stray session if the
  // preview had somehow been posted unthreaded.
  const memo = await resolveOutcomeMemo(rows, channelId, threadTs);
  const verb = actionId === AGENT_CONFIRM_ACTION_ID ? 'Confirmed.' : 'Cancelled.';

  if (results.length === 1) {
    const only = results[0];
    let postedTs: string | undefined;
    try {
      if (only.forbidden) {
        await web.chat.postEphemeral({
          channel: channelId,
          user: slackUserId,
          text: only.text,
          ...(threadTs ? { thread_ts: threadTs } : {}),
        });
        // Only this user saw it, and it isn't an outcome — nothing happened.
        return;
      }
      const posted = await web.chat.postMessage({
        channel: channelId,
        // No top-level `text` on purpose — the attachment renders it, and
        // setting both made every result appear twice. Its `fallback` covers
        // notifications.
        attachments: buildResultAttachments(
          only.text,
          actionId === AGENT_CANCEL_ACTION_ID
            ? 'cancelled'
            : only.ok
              ? 'committed'
              : 'failed',
        ) as never,
        ...(threadTs ? { thread_ts: threadTs } : {}),
        unfurl_links: false,
        unfurl_media: false,
      });
      postedTs = typeof posted.ts === 'string' ? posted.ts : undefined;
    } catch (err) {
      console.error('[slack/interactivity] failed to post result', {
        channelId,
        pendingActionId: only.id,
        err,
      });
    }
    await recordOutcome(memo, verb, only.text, pendingActionIds, results, postedTs);
    if (actionId === AGENT_CONFIRM_ACTION_ID) {
      await postContinuation(web, channelId, threadTs, rows, results, memo);
    }
    return;
  }

  // Multi-action: produce one summary message. Forbidden entries (this
  // user didn't own the original action) are listed in the failed
  // section rather than as ephemerals, so the channel/thread reads as
  // one coherent outcome.
  const succeeded = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const successVerb =
    actionId === AGENT_CONFIRM_ACTION_ID ? 'Committed' : 'Cancelled';
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
  const combined = parts.join('\n');

  let combinedTs: string | undefined;
  try {
    const posted = await web.chat.postMessage({
      channel: channelId,
      // See the single-action path: the attachment is the only renderer.
      attachments: buildResultAttachments(
        combined,
        actionId === AGENT_CANCEL_ACTION_ID
          ? 'cancelled'
          : failed.length > 0
            ? 'failed'
            : 'committed',
      ) as never,
      ...(threadTs ? { thread_ts: threadTs } : {}),
      unfurl_links: false,
      unfurl_media: false,
    });
    combinedTs = typeof posted.ts === 'string' ? posted.ts : undefined;
  } catch (err) {
    console.error('[slack/interactivity] failed to post combined result', {
      channelId,
      pendingActionIds,
      err,
    });
  }

  await recordOutcome(memo, verb, combined, pendingActionIds, results, combinedTs);

  if (actionId === AGENT_CONFIRM_ACTION_ID) {
    await postContinuation(web, channelId, threadTs, rows, results, memo);
  }
}

/**
 * Who and where to record a click's outcome against.
 *
 * The requester is the right author: confirmPendingAction already refuses
 * anyone else, so a click that got this far came from the person whose preview
 * it was. Returns null when the bundle has aged out of the table entirely —
 * there's nothing to attribute, and losing the transcript line matters less
 * than throwing inside a handler that has already committed real writes.
 */
async function resolveOutcomeMemo(
  rows: Awaited<ReturnType<typeof loadPendingActionsByIds>>,
  channelId: string,
  fallbackThreadTs: string | undefined,
): Promise<{ sessionId: string | null; appUserId: string } | null> {
  const row = rows[0];
  if (!row?.requester_app_user_id) {
    console.warn('[slack/interactivity] no requester on bundle; outcome not recorded', {
      channelId,
    });
    return null;
  }
  const sessionId = await resolveSlackSession({
    appUserId: row.requester_app_user_id,
    orgId: row.org_id,
    channelId: row.slack_channel_id ?? channelId,
    threadTs: row.slack_thread_ts ?? fallbackThreadTs ?? null,
  });
  return { sessionId, appUserId: row.requester_app_user_id };
}

/**
 * Persist the click and its result as a turn, mirroring what /api/agent/confirm
 * writes on the web side: one user row for the button press, one assistant row
 * for what came of it.
 */
async function recordOutcome(
  memo: { sessionId: string | null; appUserId: string } | null,
  verb: string,
  text: string,
  pendingActionIds: string[],
  results: Array<{ id: string; ok: boolean }>,
  postedTs: string | undefined,
): Promise<void> {
  if (!memo) return;
  // The click itself is a button press, not a Slack message, so the user row
  // has no ts to carry. The result post does.
  await appendMessage({
    sessionId: memo.sessionId,
    appUserId: memo.appUserId,
    surface: 'slack',
    role: 'user',
    content: verb,
    metadata: { pending_action_ids: pendingActionIds },
  });
  await appendMessage({
    sessionId: memo.sessionId,
    appUserId: memo.appUserId,
    surface: 'slack',
    role: 'assistant',
    content: text,
    slackMessageTs: postedTs,
    metadata: {
      pending_action_ids: pendingActionIds,
      pending_action_results: results.map((r) => ({ id: r.id, ok: r.ok })),
    },
  });
}

/**
 * Finish the plan when the agent registered a dependent next step and the whole
 * bundle committed. maybeRunContinuation returns null in every other case
 * (cancel, any failure, no follow-up, depth cap), so this is a no-op on the
 * ordinary confirm — one in-memory check, no model call.
 *
 * A continuation that previews further writes gets its own Confirm/Cancel pair,
 * exactly like a normal agent turn: continuing never skips the confirm gate.
 */
async function postContinuation(
  web: WebClient,
  channelId: string,
  threadTs: string | undefined,
  rows: Awaited<ReturnType<typeof loadPendingActionsByIds>>,
  results: Array<{ ok: boolean; text: string }>,
  memo: { sessionId: string | null; appUserId: string } | null,
): Promise<void> {
  let continuation;
  try {
    continuation = await maybeRunContinuation({
      rows,
      results,
      surface: 'slack',
      sessionId: memo?.sessionId ?? null,
    });
  } catch (err) {
    console.error('[slack/interactivity] continuation failed', { channelId, err });
    return;
  }
  if (!continuation) return;

  try {
    const blocks =
      continuation.pendingActionIds.length > 0
        ? [
            {
              type: 'section',
              text: { type: 'mrkdwn', text: markdownToMrkdwn(continuation.text) },
            },
            ...buildConfirmationBlocks(continuation.pendingActionIds),
          ]
        : undefined;
    const posted = await web.chat.postMessage({
      channel: channelId,
      text: markdownToMrkdwn(continuation.text),
      ...(threadTs ? { thread_ts: threadTs } : {}),
      ...(blocks ? { blocks: blocks as never } : {}),
      unfurl_links: false,
      unfurl_media: false,
    });
    await setPendingActionMessageTs(
      continuation.pendingActionIds,
      typeof posted.ts === 'string' ? posted.ts : undefined,
    );
    if (memo) {
      await appendMessage({
        sessionId: memo.sessionId,
        appUserId: memo.appUserId,
        surface: 'slack',
        role: 'assistant',
        content: continuation.text,
        slackMessageTs: typeof posted.ts === 'string' ? posted.ts : undefined,
        metadata: {
          continuation_of: rows.map((r) => r.id),
          ...(continuation.pendingActionIds.length > 0
            ? { pending_action_ids: continuation.pendingActionIds }
            : {}),
        },
      });
    }
  } catch (err) {
    console.error('[slack/interactivity] failed to post continuation', { channelId, err });
  }
}
