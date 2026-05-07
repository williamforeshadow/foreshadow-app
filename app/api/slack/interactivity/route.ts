import { NextRequest, NextResponse, after } from 'next/server';
import { WebClient } from '@slack/web-api';
import { verifySlackSignature } from '@/src/slack/verify';
import {
  AGENT_CANCEL_ACTION_ID,
  AGENT_CONFIRM_ACTION_ID,
  cancelPendingAction,
  confirmPendingAction,
} from '@/src/server/agent/pendingActions';

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
  if (
    actionId !== AGENT_CONFIRM_ACTION_ID &&
    actionId !== AGENT_CANCEL_ACTION_ID
  ) {
    return;
  }

  const pendingActionId = action?.value;
  const slackUserId = payload.user?.id;
  const channelId = payload.channel?.id;
  if (!pendingActionId || !slackUserId || !channelId) {
    console.warn('[slack/interactivity] missing action payload fields', {
      actionId,
      pendingActionId,
      slackUserId,
      channelId,
    });
    return;
  }

  const result =
    actionId === AGENT_CONFIRM_ACTION_ID
      ? await confirmPendingAction({
          actionId: pendingActionId,
          slackUserId,
        })
      : await cancelPendingAction({
          actionId: pendingActionId,
          slackUserId,
        });

  const web = new WebClient(botToken);
  const messageTs = payload.message?.thread_ts ?? payload.message?.ts;
  const threadTs = channelId.startsWith('D') ? undefined : messageTs;

  try {
    if (result.error === 'forbidden') {
      await web.chat.postEphemeral({
        channel: channelId,
        user: slackUserId,
        text: result.text,
        ...(threadTs ? { thread_ts: threadTs } : {}),
      });
      return;
    }
    await web.chat.postMessage({
      channel: channelId,
      text: result.text,
      ...(threadTs ? { thread_ts: threadTs } : {}),
      unfurl_links: false,
      unfurl_media: false,
    });
  } catch (err) {
    console.error('[slack/interactivity] failed to post result', {
      channelId,
      pendingActionId,
      err,
    });
  }
}
