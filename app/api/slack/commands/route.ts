import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { WebClient } from '@slack/web-api';
import type { Block } from '@slack/types';
import { verifySlackSignature } from '@/src/slack/verify';
import { resolveSlackUser } from '@/src/slack/identity';
import { runMyAssignments } from '@/src/slack/commands/myAssignments';
import { runDailyOutlook } from '@/src/slack/commands/dailyOutlook';

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
//   /myassignments posts an EPHEMERAL message in the channel where the
//   command was invoked (chat.postEphemeral, channel = payload.channel_id).
//   Only the invoker sees it. The reply IS the response — there's no
//   "go check your DMs" round-trip and no thread to expand.
//
// Block layout (two modes, gated on count):
//   ≤10 tasks → header + one top-level `card` block per assignment.
//               Each card has a title (task title), subtitle (property
//               or "No property"), and a single "↗" URL button.
//   >10 tasks → header + one bullet-list `section` block. Each line is
//               `• <url|Title>` — Slack's native link syntax, the
//               same shape the agent's prose responses use.
//
//   See src/slack/assignmentBlocks.ts for the builder + the rationale.
//   The mode threshold (MAX_ASSIGNMENT_CARDS) matches MAX_CAROUSEL_CARDS
//   in src/slack/unfurl.ts so both surfaces switch to the lightweight
//   bullet rendering at the same boundary.
//
//   The top-level `card` block isn't in @slack/types' KnownBlock union
//   (the SDK only models it as a `carousel` child), so we cast at the
//   boundary. Confirmed working via chat.postEphemeral in this Slack
//   workspace — if a future Slack API change ever rejects the payload
//   we'd see `invalid_blocks` from the WebClient call and the bullet
//   fallback would be the easy escape hatch (apply it unconditionally).
//
//   Past experiments on `/myassignments` that were abandoned:
//     - response_url with a carousel  → HTTP 500
//     - carousel via chat.postEphemeral → URL buttons never navigated
//       (predates the /api/slack/interactivity ack route)
//     - carousel via chat.postMessage to a DM → same button gap
//     - chat.postMessage with task_card blocks → invalid_blocks
//       (task_card is streaming-only)
//     - chat.startStream + stopStream → works, but requires thread_ts

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
   * use it — chat.postEphemeral is the proven transport for
   * structured-block replies.
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
      return new NextResponse(null, { status: 200 });
    }
    case '/dailyoutlook': {
      after(async () => {
        const web = new WebClient(botToken);
        try {
          await handleDailyOutlook(web, payload);
        } catch (err) {
          console.error('[slack/commands] /dailyoutlook handler crashed', {
            user_id: payload.user_id,
            err,
          });
          await postEphemeralSafe(web, {
            channel: payload.channel_id,
            user: payload.user_id,
            text: `Sorry — something went wrong running /dailyoutlook. Try again in a moment.`,
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
  // useful answer in that case. Surface the failure as plain
  // ephemeral text where they typed the command — most discoverable
  // place for an "I don't know who you are" message.
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

  // Single ephemeral post, in the channel where the command was
  // invoked. Slack renders the blocks inline; the `text` field
  // serves as notification fallback.
  await postEphemeralSafe(web, {
    channel: payload.channel_id,
    user: payload.user_id,
    text: result.text,
    blocks: result.blocks.length > 0 ? result.blocks : undefined,
  });
}

async function handleDailyOutlook(
  web: WebClient,
  payload: SlashCommandPayload,
): Promise<void> {
  const identity = await resolveSlackUser(web, payload.user_id);
  if (!identity) {
    await postEphemeralSafe(web, {
      channel: payload.channel_id,
      user: payload.user_id,
      text: `I don't recognize this Slack account. Ask Billy to add your email to Foreshadow so I can connect you, then try again.`,
    });
    return;
  }

  const result = await runDailyOutlook({
    appUserId: identity.appUserId,
    displayName: identity.appUserName,
  });

  await postEphemeralSafe(web, {
    channel: payload.channel_id,
    user: payload.user_id,
    text: result.text,
    blocks: result.blocks.length > 0 ? result.blocks : undefined,
  });
}

interface PostEphemeralArgs {
  channel: string;
  user: string;
  text: string;
  // Block[] (not KnownBlock[]) because /myassignments emits top-level
  // `card` blocks that aren't in @slack/types' KnownBlock union.
  blocks?: Block[];
}

// chat.postEphemeral wrapper that swallows + logs errors instead of
// throwing. We're inside an `after()` callback when this runs, so a
// throw would just become an unhandled rejection — better to log
// and move on.
//
// The blocks parameter is optional: the no-results path passes only
// `text` (Slack renders that inline as the ephemeral body).
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
    });
  } catch (err) {
    console.error('[slack/commands] chat.postEphemeral failed', {
      channel: args.channel,
      user: args.user,
      err,
    });
  }
}
