import { NextRequest, NextResponse, after } from 'next/server';
import { WebClient } from '@slack/web-api';
import { verifySlackSignature } from '@/src/slack/verify';
import {
  AGENT_CANCEL_ACTION_ID,
  AGENT_CONFIRM_ACTION_ID,
  cancelPendingAction,
  confirmPendingAction,
} from '@/src/server/agent/pendingActions';
import { decodePendingActionIds } from '@/src/server/agent/slackConfirmationBlocks';
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

interface SlackInteractionPayload {
  type?: string;
  user?: { id?: string };
  channel?: { id?: string };
  message?: { ts?: string; thread_ts?: string };
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
  const web = new WebClient(botToken);
  const messageTs = payload.message?.thread_ts ?? payload.message?.ts;
  const threadTs = channelId.startsWith('D') ? undefined : messageTs;

  if (results.length === 1) {
    const only = results[0];
    try {
      if (only.forbidden) {
        await web.chat.postEphemeral({
          channel: channelId,
          user: slackUserId,
          text: only.text,
          ...(threadTs ? { thread_ts: threadTs } : {}),
        });
        return;
      }
      await web.chat.postMessage({
        channel: channelId,
        text: only.text,
        ...(threadTs ? { thread_ts: threadTs } : {}),
        unfurl_links: false,
        unfurl_media: false,
      });
    } catch (err) {
      console.error('[slack/interactivity] failed to post result', {
        channelId,
        pendingActionId: only.id,
        err,
      });
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

  try {
    await web.chat.postMessage({
      channel: channelId,
      text: combined,
      ...(threadTs ? { thread_ts: threadTs } : {}),
      unfurl_links: false,
      unfurl_media: false,
    });
  } catch (err) {
    console.error('[slack/interactivity] failed to post combined result', {
      channelId,
      pendingActionIds,
      err,
    });
  }
}
