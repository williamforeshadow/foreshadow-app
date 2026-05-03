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
//      reply lands a moment later, posted from `after()` so we never
//      block the webhook.
//
// Where the reply lands (and why):
//   /myassignments DMs the user with a `chat.postMessage` carrying the
//   carousel of task cards, plus a small ephemeral "Sent to your DMs →"
//   confirmation at the slash-command site.
//
//   Earlier iterations tried response_url and chat.postEphemeral with
//   the carousel inline. Both surfaces have known gaps for `card.actions[]`
//   buttons inside `carousel` blocks:
//     - response_url returned HTTP 500 from hooks.slack.com on every
//       payload with a carousel block — Slack's legacy followup
//       transport hasn't picked up the newer Block Kit shapes.
//     - chat.postEphemeral RENDERS the carousel correctly, but the
//       "Open in Foreshadow" button never opens the URL on click,
//       even with Interactivity enabled and our /api/slack/interactivity
//       endpoint receiving + acking 200. The same blocks via
//       chat.postMessage open the URL fine, so it's a Slack platform
//       gap on the ephemeral surface specifically. We confirmed in
//       Vercel logs that Slack DOES POST to interactivity on the
//       click — it just declines to navigate the URL afterward.
//
//   Pivoting to a DM via chat.postMessage uses the same proven
//   transport the events-route bot replies use (carousel + url
//   buttons proven working). UX-wise it also fits "personal info"
//   commands better — the reply is private, scrollable, and lives
//   in a stable place the user can return to. Linear / Asana / GitHub
//   all use this exact pattern for their personal-info slash commands.

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
      // chat.postMessage to a DM (with an inline ephemeral "Sent to
      // your DMs →" confirmation alongside) from the deferred work.
      after(async () => {
        const web = new WebClient(botToken);
        try {
          await handleMyAssignments(web, payload);
        } catch (err) {
          console.error('[slack/commands] /myassignments handler crashed', {
            user_id: payload.user_id,
            err,
          });
          // Crash fallback uses the inline ephemeral surface — plain
          // text, no blocks, ephemeral handles that fine. The user
          // sees the failure where they typed the command, which is
          // the most discoverable place for an error message.
          await postEphemeralSafe(web, {
            channel: payload.channel_id,
            user: payload.user_id,
            text: `Sorry — something went wrong running /myassignments. Try again in a moment.`,
          });
        }
      });
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
  // useful answer in that case. The "I don't recognize you" reply
  // goes back as an inline ephemeral at the slash-command site —
  // it's plain text only (no carousel), so ephemeral is fine here
  // and it's more discoverable than DMing a confused user.
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

  // Open (or look up the existing) DM channel between the bot and
  // the invoker. conversations.open is idempotent — Slack returns the
  // same channel id on subsequent calls. Costs ~50ms cold; nothing
  // when warm.
  const dmChannel = await openDmChannel(web, payload.user_id);
  if (!dmChannel) {
    // DM open failed — surface a fallback ephemeral so the user knows
    // the command ran but we couldn't deliver. This shouldn't happen
    // in practice (bot has im:write scope and the invoker is the same
    // user), but logging the failure mode makes it diagnosable.
    await postEphemeralSafe(web, {
      channel: payload.channel_id,
      user: payload.user_id,
      text: `Sorry — I couldn't open a DM with you. Try messaging me directly first, then re-run /myassignments.`,
    });
    return;
  }

  // Two parallel posts:
  //   - Real reply with cards goes to the DM (chat.postMessage,
  //     proven to render carousel + url buttons correctly).
  //   - "Sent to your DMs →" ephemeral goes inline at the slash-command
  //     site so the user gets immediate feedback that something
  //     happened. Pure plain text — no blocks involved, so the
  //     ephemeral surface handles it without issue.
  // Doing them in parallel saves ~100ms vs sequential and the two
  // calls don't depend on each other.
  await Promise.all([
    postDmMessageSafe(web, {
      channel: dmChannel,
      text: result.text,
      blocks: result.blocks,
      attachments: result.attachments,
    }),
    postEphemeralSafe(web, {
      channel: payload.channel_id,
      user: payload.user_id,
      text: `Sent to your DMs →`,
    }),
  ]);
}

// Open a DM channel with the given Slack user. Returns the channel id
// (a "D..." string) or null if the open call failed. We pull this out
// to keep handleMyAssignments readable; the fallback messaging when
// DM-open fails belongs to the caller.
async function openDmChannel(
  web: WebClient,
  slackUserId: string,
): Promise<string | null> {
  try {
    const conv = await web.conversations.open({ users: slackUserId });
    const id = conv.channel?.id;
    return typeof id === 'string' && id.length > 0 ? id : null;
  } catch (err) {
    console.error('[slack/commands] conversations.open failed', {
      slackUserId,
      err,
    });
    return null;
  }
}

interface PostEphemeralArgs {
  channel: string;
  user: string;
  text: string;
  blocks?: Block[];
  attachments?: MessageAttachment[];
}

interface PostDmArgs {
  channel: string;
  text: string;
  blocks?: Block[];
  attachments?: MessageAttachment[];
}

// chat.postMessage to a DM channel. Same transport the events route
// uses for bot replies — proven path for carousel + url buttons. We
// disable link unfurling on the bot's own message so Slack doesn't
// double up "card from blocks" + "link unfurl from text" for the same
// task URL.
async function postDmMessageSafe(
  web: WebClient,
  args: PostDmArgs,
): Promise<void> {
  try {
    await web.chat.postMessage({
      channel: args.channel,
      text: args.text,
      ...(args.blocks ? { blocks: args.blocks } : {}),
      ...(args.attachments ? { attachments: args.attachments } : {}),
      unfurl_links: false,
      unfurl_media: false,
    });
  } catch (err) {
    console.error('[slack/commands] chat.postMessage to DM failed', {
      channel: args.channel,
      err,
    });
  }
}

// Thin wrapper around chat.postEphemeral that swallows + logs errors
// instead of throwing. We're already inside `after()` when this runs,
// so a throw would just become an unhandled rejection — better to log
// and move on.
//
// Used for the inline "Sent to your DMs →" confirmation and for the
// plain-text fallback messages (unrecognised user, DM-open failure).
// Carousel-bearing replies don't go through here anymore; they go via
// postDmMessageSafe.
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
