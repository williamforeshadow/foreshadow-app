import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { WebClient } from '@slack/web-api';
import type { Block, MessageAttachment } from '@slack/types';
import { verifySlackSignature } from '@/src/slack/verify';
import { resolveSlackUser } from '@/src/slack/identity';
import { runMyAssignments } from '@/src/slack/commands/myAssignments';

// POST /api/slack/commands
//
// Slack slash-command webhook. Distinct from /api/slack/events because
// slash commands ship as `application/x-www-form-urlencoded`, not JSON,
// and Slack expects a 200 ack within 3 seconds.
//
// Why slash commands skip the agent: the questions they answer ("what's
// on my plate?", "queue me a turnover", etc.) are deterministic. We
// already know who's asking (Slack user → app user via email match)
// and the data shape is fixed. Routing through the LLM would add
// latency, cost, and hallucination risk for zero gain.
//
// Slack app config (in api.slack.com/apps → Slash Commands):
//   - /myassignments: Request URL = https://<your-domain>/api/slack/commands
//                     Description: "Show my open task assignments"
//                     Usage hint: (none — takes no args)
//
// Required env (same as the events route):
//   SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, APP_BASE_URL
//
// Lifecycle:
//   1. Verify HMAC signature on the raw body (Slack signs bytes-on-the-wire,
//      not the parsed form — same rule as the events route).
//   2. Parse the urlencoded form into a typed payload.
//   3. Dispatch on `command`. Unknown commands return a 200 with an
//      ephemeral "unknown command" — Slack treats anything else as a
//      hard error and shows the user a generic failure message.
//   4. Ack 200 immediately (within 3s) with an empty body. The actual
//      reply lands a moment later via chat.postEphemeral, posted from
//      `after()` so we never block the webhook.
//
// Why chat.postEphemeral instead of response_url:
//   The first cut of this route used response_url (the URL Slack hands
//   us in the slash-command payload, designed exactly for this kind of
//   followup). It returned HTTP 500 from hooks.slack.com whenever the
//   payload included a `carousel` block — Slack's response_url
//   transport hasn't caught up to the newer Block Kit types that
//   chat.postMessage / chat.postEphemeral already support. Switching
//   to chat.postEphemeral aligns this surface with the proven path
//   the events route uses (chat.postMessage with carousel blocks),
//   the only difference being "ephemeral" so only the invoker sees it.
//
// Tradeoff: there's no placeholder ("Looking up your open assignments…")
// anymore — chat.postEphemeral can't replace a previous ephemeral
// response, so the cleanest UX is a brief silent beat (typically
// <500ms based on Vercel function timings) followed by the real reply.

interface SlashCommandPayload {
  /** Token from the X-Slack-Signature dance. Already verified before this struct exists. */
  team_id: string;
  channel_id: string;
  /** Slack user id of the invoker (Uxxxxx). */
  user_id: string;
  /** The slash command itself, e.g. "/myassignments" (with leading slash). */
  command: string;
  /** Argument text after the command name. Empty string when none. */
  text: string;
  /**
   * One-shot URL Slack hands us for posting deferred replies. Kept on
   * the parsed payload type for completeness (and as a fallback if a
   * future command needs it), but the /myassignments handler doesn't
   * use it — see the header comment for why.
   */
  response_url: string;
}

export async function POST(req: NextRequest) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET ?? '';
  const botToken = process.env.SLACK_BOT_TOKEN ?? '';
  if (!signingSecret || !botToken) {
    console.error('[slack/commands] missing env', {
      has_signing_secret: !!signingSecret,
      has_bot_token: !!botToken,
    });
    return NextResponse.json(
      { error: 'Slack integration is not configured' },
      { status: 500 },
    );
  }

  // Slack signs the raw body bytes. We MUST read the body as text once
  // and reuse it for both verification and parsing — letting Next parse
  // the form would change the byte ordering and break the HMAC.
  const rawBody = await req.text();

  const verify = verifySlackSignature(
    rawBody,
    req.headers.get('x-slack-signature'),
    req.headers.get('x-slack-request-timestamp'),
    signingSecret,
  );
  if (!verify.ok) {
    console.warn('[slack/commands] signature verification failed', {
      reason: verify.reason,
    });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const payload = parseSlashCommandPayload(rawBody);
  if (!payload) {
    return NextResponse.json(
      { error: 'Malformed slash command payload' },
      { status: 400 },
    );
  }

  // Dispatch. Today there's only one command; new ones land here as
  // additional cases. Anything we don't recognise gets an ephemeral
  // hint via the immediate response (no chat.postEphemeral needed) —
  // Slack renders this inline at the slash-command site.
  switch (payload.command) {
    case '/myassignments': {
      // Defer the actual work via after() so we ack within 3s. The
      // immediate response is empty — Slack accepts that as "command
      // received, no inline reply" — and the real reply arrives via
      // chat.postEphemeral from the deferred work.
      after(async () => {
        const web = new WebClient(botToken);
        try {
          await handleMyAssignments(web, payload);
        } catch (err) {
          console.error('[slack/commands] /myassignments handler crashed', {
            user_id: payload.user_id,
            err,
          });
          await postEphemeralSafe(web, {
            channel: payload.channel_id,
            user: payload.user_id,
            text: `Sorry — something went wrong running /myassignments. Try again in a moment.`,
          });
        }
      });
      // Empty 200 ack. No placeholder text — see header comment for why.
      return new NextResponse(null, { status: 200 });
    }
    default: {
      // Inline ephemeral via the immediate response. This is the one
      // place response_url-style inline replies still make sense:
      // there's no Block Kit involved, just plain text, so the
      // legacy transport handles it cleanly.
      return NextResponse.json({
        response_type: 'ephemeral',
        text: `Unknown command \`${payload.command}\`.`,
      });
    }
  }
}

// Slack ships slash commands as form-urlencoded bodies. We parse only
// the fields we actually use; missing fields → null payload (caller
// returns 400). All fields are strings; URLSearchParams returns "" for
// keys-without-values which we treat as absent for command/user_id.
function parseSlashCommandPayload(rawBody: string): SlashCommandPayload | null {
  const params = new URLSearchParams(rawBody);
  const team_id = params.get('team_id');
  const channel_id = params.get('channel_id');
  const user_id = params.get('user_id');
  const command = params.get('command');
  const response_url = params.get('response_url');
  if (!team_id || !channel_id || !user_id || !command || !response_url) {
    return null;
  }
  return {
    team_id,
    channel_id,
    user_id,
    command,
    text: params.get('text') ?? '',
    response_url,
  };
}

async function handleMyAssignments(
  web: WebClient,
  payload: SlashCommandPayload,
): Promise<void> {
  // Resolve the invoker. Without an email match we can't link the
  // Slack account to a Foreshadow user, and /myassignments has no
  // useful answer in that case. We surface a friendly "ask Billy to
  // hook you up" message instead of running an empty query.
  const identity = await resolveSlackUser(web, payload.user_id);
  if (!identity) {
    await postEphemeralSafe(web, {
      channel: payload.channel_id,
      user: payload.user_id,
      text: `I don't recognize this Slack account. Ask Billy to add your email to Foreshadow so I can connect you, then try again.`,
    });
    return;
  }

  const result = await runMyAssignments({
    appUserId: identity.appUserId,
    displayName: identity.appUserName,
  });

  await postEphemeralSafe(web, {
    channel: payload.channel_id,
    user: payload.user_id,
    text: result.text,
    blocks: result.blocks,
    attachments: result.attachments,
  });
}

interface PostEphemeralArgs {
  channel: string;
  user: string;
  text: string;
  blocks?: Block[];
  attachments?: MessageAttachment[];
}

// Thin wrapper around chat.postEphemeral that swallows + logs errors
// instead of throwing. We're already inside `after()` when this runs,
// so a throw would just become an unhandled rejection — better to log
// and move on.
//
// Note: chat.postEphemeral ALSO requires the bot to be a member of the
// invoking channel for non-DM cases. For DMs (channel id starts with
// "D") that's automatic. For channels the bot has been invited to,
// it works. For channels the bot ISN'T in, Slack returns
// `channel_not_found` — the user just won't see the reply, which is
// the same failure mode response_url had. Acceptable for now; if we
// hit it in practice we can fall back to a DM via web.conversations.open.
async function postEphemeralSafe(
  web: WebClient,
  args: PostEphemeralArgs,
): Promise<void> {
  try {
    await web.chat.postEphemeral({
      channel: args.channel,
      user: args.user,
      text: args.text,
      ...(args.blocks ? { blocks: args.blocks } : {}),
      ...(args.attachments ? { attachments: args.attachments } : {}),
    });
  } catch (err) {
    console.error('[slack/commands] chat.postEphemeral failed', {
      channel: args.channel,
      user: args.user,
      err,
    });
  }
}
