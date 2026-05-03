import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { WebClient } from '@slack/web-api';
import type { AnyChunk } from '@slack/types';
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
//   /myassignments STREAMS the assignment list into a DM with the user
//   via Slack's text-streaming API:
//     1. conversations.open       → DM channel id
//     2. chat.startStream         → opens a streaming message carrying
//                                   one markdown_text header chunk and
//                                   one task_update chunk per task
//     3. chat.stopStream          → finalises the message and clears the
//                                   "streaming" loading indicator
//   …plus a small `chat.postEphemeral` confirmation at the slash-
//   command site so the user gets immediate feedback. The DM target
//   fits "personal info" commands — scrollable, private, lives in a
//   stable place the user can return to.
//
// Why streaming chunks (and not chat.postMessage with blocks):
//   Slack's `task_card` block — the collapsible expandable-row visual
//   we want — is REJECTED by chat.postMessage with `invalid_blocks`.
//   The Slack platform 2026 changelog confirms task_card is a
//   streaming-only primitive, only accepted via the chunks parameter
//   on the chat.{start,append,stop}Stream methods. The streaming
//   `task_update` chunk renders as the same expandable-row UI and
//   exposes a `sources` field whose URL elements Slack renders as
//   native hyperlinks — guaranteed click-through, no interactivity
//   ack required.
//
//   Earlier carousel-based attempts failed clickable-URL on every
//   surface tried: response_url (HTTP 500 on carousel payloads),
//   chat.postEphemeral (carousel renders, buttons don't navigate),
//   and chat.postMessage-to-DM (same as ephemeral). The
//   chat.postMessage-with-task_card attempt failed validation
//   outright. Streaming task_update is the documented, supported
//   path for this visual.
//
//   The events route (bot replies to free-text questions) keeps using
//   the carousel via chat.postMessage — it works there because the
//   message has a parent (the user's question), and the horizontal
//   layout fits alongside the agent's prose summary. Surface-specific
//   choices.

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

  // 0-results case: skip the streaming dance entirely. There's nothing
  // to render with task_update chunks, and the user gets faster
  // feedback if we just tell them inline at the slash-command site.
  if (result.chunks.length === 0) {
    await postEphemeralSafe(web, {
      channel: payload.channel_id,
      user: payload.user_id,
      text: result.text,
    });
    return;
  }

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

  // Stream the task_update chunks into the DM, then post the inline
  // ephemeral confirmation at the slash-command site. Both are
  // best-effort — failures are logged but don't propagate, since
  // we're inside an `after()` callback where throws become unhandled
  // rejections.
  //
  // Order matters here: we open the stream FIRST, so by the time we
  // post the "Sent to your DMs →" confirmation the message exists in
  // the DM. The two calls run in parallel via Promise.all because they
  // touch different channels and don't depend on each other.
  await Promise.all([
    streamAssignmentsToDmSafe(web, {
      channel: dmChannel,
      fallbackText: result.text,
      chunks: result.chunks,
      recipientTeamId: payload.team_id,
      recipientUserId: payload.user_id,
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

interface StreamAssignmentsArgs {
  /** DM channel id (D...) returned from conversations.open. */
  channel: string;
  /**
   * Notification-fallback text. Used as the message-level `text` field
   * via the markdown_text chunk that headers the streaming payload.
   */
  fallbackText: string;
  /**
   * Streaming chunks built upstream by myAssignments → buildAssignmentChunks.
   * Already includes the markdown_text header as chunks[0], so the
   * stream call doesn't need to set markdown_text separately.
   */
  chunks: AnyChunk[];
  /**
   * Recipient context. Required when starting a stream outside a DM,
   * optional inside a DM — we pass them anyway because we have them
   * for free from the slash-command payload and Slack ignores them
   * when not needed.
   */
  recipientTeamId: string;
  recipientUserId: string;
}

// Stream the assignment list into a DM via Slack's chat.startStream
// + chat.stopStream methods. Required for `task_update` chunks
// (chat.postMessage rejects them with `invalid_blocks` — task_update
// / task_card are streaming-only primitives).
//
// Two-call shape:
//   - chat.startStream  opens the streaming message AND attaches all
//     the chunks (header + task_updates). Since we have the full
//     payload up-front, we don't need chat.appendStream — opening
//     with the chunks already attached saves a round-trip.
//   - chat.stopStream   finalises the message so Slack's "streaming"
//     loading indicator goes away. Without this the message stays
//     in a perpetual loading state on clients.
//
// Best-effort: any error is logged but never thrown. We're inside an
// `after()` callback when this runs; an unhandled rejection would just
// dangle. The Slack API surfaces logical errors as `{ ok: false, error:
// '...' }` in the response body — those throw a `slack_webapi_platform_error`
// from the SDK, which lands in the catch and gets logged with the
// chunk count for diagnosis.
async function streamAssignmentsToDmSafe(
  web: WebClient,
  args: StreamAssignmentsArgs,
): Promise<void> {
  let streamTs: string | null = null;
  try {
    // Cast: @slack/web-api's TS type makes `thread_ts` required, but
    // the actual API documents it as optional and we don't have a
    // parent message — slash commands aren't replies to anything.
    // Slack accepts the call without thread_ts; the SDK type is just
    // overly strict (likely modelled off the assistant-message use
    // case where threads always exist).
    const startResp = await web.chat.startStream({
      channel: args.channel,
      recipient_team_id: args.recipientTeamId,
      recipient_user_id: args.recipientUserId,
      // task_display_mode: "timeline" renders each task as its own row
      // (matches our /myassignments use case — independent items, no
      // shared parent goal). "plan" would group them under a single
      // unified-plan title which doesn't fit a personal task list.
      task_display_mode: 'timeline',
      chunks: args.chunks,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    streamTs = (startResp.ts as string | undefined) ?? null;
  } catch (err) {
    console.error('[slack/commands] chat.startStream failed', {
      channel: args.channel,
      chunk_count: args.chunks.length,
      err,
    });
    return;
  }

  // Finalise. If startStream succeeded but didn't return a ts (would
  // be surprising — Slack always returns one on ok=true), we skip
  // stopStream rather than guess; Slack will eventually time out the
  // stream on its own.
  if (!streamTs) {
    console.warn('[slack/commands] chat.startStream succeeded but no ts', {
      channel: args.channel,
    });
    return;
  }
  try {
    await web.chat.stopStream({
      channel: args.channel,
      ts: streamTs,
    });
  } catch (err) {
    console.error('[slack/commands] chat.stopStream failed', {
      channel: args.channel,
      ts: streamTs,
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
