import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { WebClient } from '@slack/web-api';
import type { Block } from '@slack/types';
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
//   /myassignments DMs the user with a `chat.postMessage` carrying a
//   vertical stack of `task_card` blocks (one per assignment), plus a
//   small ephemeral "Sent to your DMs →" confirmation at the slash-
//   command site. The DM target fits "personal info" commands —
//   scrollable, private, and lives in a stable place the user can
//   return to.
//
// Why task_card and not carousel:
//   Earlier iterations tried response_url, chat.postEphemeral, and
//   DM-via-chat.postMessage all carrying a `carousel` of `card`
//   elements. Each one had its own clickable-URL gap:
//     - response_url: HTTP 500 on every payload with a carousel block.
//     - chat.postEphemeral: carousel renders, but card.actions[] url
//       buttons never navigate on click (even with Interactivity
//       enabled and /api/slack/interactivity acking 200).
//     - chat.postMessage to DM: carousel-only blocks array also failed
//       button URL navigation; mirroring the events-route shape
//       ([section, carousel]) didn't fix it on the slash-command path.
//   Slack's `task_card` block uses `sources` (an array of URL elements)
//   instead of `actions[]` for the click-through, and Slack renders
//   sources as native hyperlinks rather than interactivity buttons.
//   That's the proven-reliable transport for clickable URLs across
//   every surface, with no signature-verification or interactivity-
//   acknowledgment dance required. The expandable-row UX also matches
//   "scan a personal task list, drill into one" better than horizontal
//   carousel scroll.
//
//   The events route (bot replies to free-text questions) keeps using
//   the carousel — it works there, and the horizontal layout fits
//   alongside the agent's prose summary. Surface-specific choices.

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
  //   - Real reply with task_card blocks goes to the DM via
  //     chat.postMessage. task_card uses `sources` for clickable
  //     URLs, which Slack renders as native hyperlinks across every
  //     surface — no interactivity acknowledgment needed.
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
}

interface PostDmArgs {
  channel: string;
  text: string;
  blocks?: Block[];
}

// chat.postMessage to a DM channel carrying the task_card list.
//
// Why we prepend a `section` block carrying the message text:
//   When `blocks` is set on chat.postMessage, Slack uses it for the
//   visible message and treats the top-level `text` field purely as
//   notification fallback (it never renders in the conversation).
//   The leading section is the visible "Billy, you have N open
//   assignments:" line above the task_card stack — without it the
//   user would see only the cards with no header context.
//
//   The shape `[section, ...task_cards]` matches the user's reference
//   Block Kit example and Slack's own task_card documentation.
//
// Disable link unfurling on the bot's own message so Slack doesn't
// double up "card from blocks" + "link unfurl from text" for the
// same task URL — the task_card sources already give the user a
// click-through link.
async function postDmMessageSafe(
  web: WebClient,
  args: PostDmArgs,
): Promise<void> {
  // No-blocks branch shouldn't really happen at this call site (the
  // 0-results case takes the early-return path before we open a DM),
  // but we handle it for completeness so the helper is safe to reuse.
  const blocks =
    args.blocks && args.blocks.length > 0
      ? ([
          { type: 'section', text: { type: 'mrkdwn', text: args.text } },
          ...args.blocks,
        ] as Block[])
      : undefined;

  try {
    await web.chat.postMessage({
      channel: args.channel,
      text: args.text,
      ...(blocks ? { blocks } : {}),
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

// Thin wrapper around chat.postEphemeral for plain-text inline
// messages (unrecognised user, DM-open failure, crash fallback,
// "Sent to your DMs →" confirmation). No blocks parameter — the
// task_card surface uses chat.postMessage, not ephemeral.
//
// Swallows + logs errors instead of throwing. We're already inside
// `after()` when this runs, so a throw would just become an unhandled
// rejection — better to log and move on.
async function postEphemeralSafe(
  web: WebClient,
  args: PostEphemeralArgs,
): Promise<void> {
  try {
    await web.chat.postEphemeral({
      channel: args.channel,
      user: args.user,
      text: args.text,
    });
  } catch (err) {
    console.error('[slack/commands] chat.postEphemeral failed', {
      channel: args.channel,
      user: args.user,
      err,
    });
  }
}
