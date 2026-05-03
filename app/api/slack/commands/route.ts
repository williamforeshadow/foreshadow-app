import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { WebClient } from '@slack/web-api';
import { verifySlackSignature } from '@/src/slack/verify';
import { resolveSlackUser } from '@/src/slack/identity';
import { runMyAssignments } from '@/src/slack/commands/myAssignments';

// POST /api/slack/commands
//
// Slack slash-command webhook. Distinct from /api/slack/events because
// slash commands ship as `application/x-www-form-urlencoded`, not JSON,
// and use a separate response model (response_url for deferred replies
// + an immediate 200 ack within 3 seconds).
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
//   4. Ack 200 immediately (within 3s) with an ephemeral "Working on it…"
//      placeholder. The actual response is POSTed to response_url from
//      `after()` so we never block the webhook.
//
// Response shape (both immediate and via response_url):
//   {
//     response_type: 'ephemeral' | 'in_channel',
//     text: string,
//     blocks?: [...],
//     attachments?: [...],
//     replace_original?: boolean   // true on response_url posts so the
//                                  //  "Working on it…" placeholder gets
//                                  //  swapped for the real reply
//   }
//
// We use `ephemeral` (only the invoker sees it) by default — /myassignments
// is personal information and doesn't need to spam the channel.

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
  /** One-shot URL for posting deferred replies. Valid for ~30 minutes. */
  response_url: string;
}

interface SlackResponseBody {
  response_type: 'ephemeral' | 'in_channel';
  text: string;
  blocks?: unknown;
  attachments?: unknown;
  replace_original?: boolean;
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
  // hint instead of a 404 — Slack renders 4xx as "the slash command
  // failed", which reads worse than an in-channel "unknown command".
  switch (payload.command) {
    case '/myassignments': {
      // Defer the actual work via after() so we ack within 3s. The
      // immediate response is a placeholder; the real reply lands
      // a moment later via response_url.
      after(async () => {
        try {
          await handleMyAssignments(payload, botToken);
        } catch (err) {
          console.error('[slack/commands] /myassignments handler crashed', {
            user_id: payload.user_id,
            err,
          });
          await postToResponseUrl(payload.response_url, {
            response_type: 'ephemeral',
            text: `Sorry — something went wrong running /myassignments. Try again in a moment.`,
            replace_original: true,
          });
        }
      });
      return NextResponse.json({
        response_type: 'ephemeral',
        text: 'Looking up your open assignments…',
      } satisfies SlackResponseBody);
    }
    default: {
      return NextResponse.json({
        response_type: 'ephemeral',
        text: `Unknown command \`${payload.command}\`.`,
      } satisfies SlackResponseBody);
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
  payload: SlashCommandPayload,
  botToken: string,
): Promise<void> {
  const web = new WebClient(botToken);

  // Resolve the invoker. Without an email match we can't link the
  // Slack account to a Foreshadow user, and /myassignments has no
  // useful answer in that case. We surface a friendly "ask Billy to
  // hook you up" message instead of running an empty query.
  const identity = await resolveSlackUser(web, payload.user_id);
  if (!identity) {
    await postToResponseUrl(payload.response_url, {
      response_type: 'ephemeral',
      text: `I don't recognize this Slack account. Ask Billy to add your email to Foreshadow so I can connect you, then try again.`,
      replace_original: true,
    });
    return;
  }

  const result = await runMyAssignments({
    appUserId: identity.appUserId,
    displayName: identity.appUserName,
  });

  await postToResponseUrl(payload.response_url, {
    response_type: 'ephemeral',
    text: result.text,
    ...(result.blocks ? { blocks: result.blocks } : {}),
    ...(result.attachments ? { attachments: result.attachments } : {}),
    replace_original: true,
  });
}

// POST a JSON body to the slash-command response_url. Slack accepts up
// to 5 followups within 30 minutes per response_url — plenty of headroom
// for the simple ack → real-reply flow we use here. We log on failure
// but don't throw because the caller is already in `after()` and there's
// no useful place to surface the error.
async function postToResponseUrl(
  url: string,
  body: SlackResponseBody,
): Promise<void> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const responseText = await res.text().catch(() => '<unreadable>');
      console.error('[slack/commands] response_url POST failed', {
        status: res.status,
        responseText,
      });
    }
  } catch (err) {
    console.error('[slack/commands] response_url POST threw', { err });
  }
}
