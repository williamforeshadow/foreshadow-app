import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { WebClient } from '@slack/web-api';
import type { Block, MessageAttachment } from '@slack/types';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { runAgent } from '@/src/agent/runAgent';
import { applyBackstops } from '@/src/agent/backstops';
import { verifySlackSignature } from '@/src/slack/verify';
import { alreadyProcessed } from '@/src/slack/dedupe';
import {
  resolveSlackUser,
  getBotUserId,
  resolveMentionsInText,
} from '@/src/slack/identity';
import {
  markdownToMrkdwn,
  stripBotMention,
  stripTaskListMetadata,
} from '@/src/slack/format';
import {
  unfurlTaskLinksFromEvent,
  buildTaskMessageExtras,
  extractTaskUrlsFromText,
} from '@/src/slack/unfurl';

interface MessageExtras {
  blocks?: Block[];
  attachments?: MessageAttachment[];
}

// POST /api/slack/events
//
// Slack Events API webhook. Mirrors the in-app /api/agent surface: same
// runAgent, same backstops, same conversation memory in ai_chat_messages —
// just with Slack-shaped IO at the edges.
//
// Three entry points are supported:
//   - app_mention          → @-mention in a channel; we reply in-thread.
//   - message (im subtype) → 1:1 DM with the bot; we reply flat in the DM.
//   - link_shared          → any message in a channel the bot is in (or a
//                             DM) containing a URL on a registered unfurl
//                             domain. We respond with chat.unfurl so the
//                             URL renders as a Block Kit task card. No
//                             agent is invoked on this path.
//
// Required env:
//   SLACK_BOT_TOKEN       (xoxb-...) — bot token used to read users.info,
//                                     post replies via chat.postMessage,
//                                     and attach unfurls via chat.unfurl.
//   SLACK_SIGNING_SECRET            — signs every event Slack sends us;
//                                     verified before any work happens.
//   APP_BASE_URL                    — required for the unfurl path to
//                                     match URLs to the right domain (see
//                                     parseTaskUrl in src/lib/links.ts).
//
// Optional env:
//   SLACK_ALLOWED_CHANNELS         — comma-separated channel ids; if set,
//                                     channel mentions from other channels
//                                     are ignored. DMs are NOT filtered
//                                     by this (they're inherently 1:1).
//                                     Empty/unset = allow all channels.
//                                     Note: link_shared is also unaffected
//                                     by this allowlist — unfurls are
//                                     passive and don't run the agent.
//
// Slack app config (in api.slack.com/apps):
//   Bot scopes:        app_mentions:read, chat:write, commands, users:read,
//                      users:read.email, im:history, im:read, im:write,
//                      links:read, links:write
//   Subscribed events: app_mention, message.im, link_shared
//   App unfurl domains: the host of APP_BASE_URL (e.g. app.foreshadow.com).
//                      Slack will only fire link_shared for URLs on
//                      domains registered here.
//   App Home tab:      enable "Allow users to send Slash commands and
//                      messages from the messages tab"
//   Slash commands:    configured separately in api.slack.com/apps →
//                      "Slash Commands"; Request URL points at
//                      /api/slack/commands. See app/api/slack/commands/route.ts.
//   Interactivity:     enable in api.slack.com/apps →
//                      "Interactivity & Shortcuts"; Request URL points at
//                      /api/slack/interactivity. Required for ephemeral
//                      carousel buttons (e.g. /myassignments) to fire —
//                      Slack's ephemeral renderer suppresses URL clicks
//                      unless interactivity is configured AND the
//                      endpoint acks 200. See
//                      app/api/slack/interactivity/route.ts.
//   Request URL:       https://<your-domain>/api/slack/events
//
// Lifecycle:
//   1. Verify HMAC signature (rejects forgeries / replays).
//   2. Handle url_verification handshake (one-time, during app setup).
//   3. Dedup by event_id (Slack retries aggressively when slow).
//   4. Classify the event as channel_mention, dm, or link_shared (else ignore).
//   5. Ack 200 immediately, defer work via `after()`.
//   6. Background:
//        a. channel_mention / dm:
//           - Resolve Slack user → app user (via email match in users table).
//           - Pull recent ai_chat_messages history for that app user.
//           - Run the agent (writes enabled, same as in-app).
//           - Apply backstops, scrub trailing inline metadata from any
//             linked-task bullet lines (the cards below the message
//             carry property/status/due, so the model is instructed not
//             to repeat them in text — this strips the leftover bits
//             when the model echoes prior assistant turns that did).
//           - Persist user + assistant messages.
//           - Build task cards for any task URLs in the reply (Slack
//             doesn't fire link_shared for our bot's own posts, so
//             chat.unfurl can't be used here — we ride the cards along
//             on the chat.postMessage payload instead). Layout is a
//             horizontal `carousel` block for ≤10 tasks (compact,
//             scrollable) and falls back to vertical `attachments` for
//             >10 (Slack's carousel cap is 10 elements).
//           - Post reply (in-thread for mentions, flat for DMs).
//        b. link_shared:
//           - Recognise task URLs via parseTaskUrl.
//           - Fetch matched tasks in one round-trip.
//           - chat.unfurl with a Block Kit card per URL, using the
//             event's unfurl_id + source pair (the modern parameter form
//             that Slack reliably honours across composer-preview and
//             post-send contexts; legacy channel + ts silently no-ops).

const MEMORY_WINDOW = 15;

interface SlackEventEnvelope {
  type: string;
  // Present on every "real" event but absent on url_verification handshake.
  event?: SlackInnerEvent;
  event_id?: string;
  team_id?: string;
  // Only on url_verification.
  challenge?: string;
}

interface SlackInnerEvent {
  type: string;
  user?: string;
  text?: string;
  channel?: string;
  ts?: string;
  thread_ts?: string;
  bot_id?: string;
  // Set when this app's own posts come back as events; we ignore them.
  app_id?: string;
  subtype?: string;
  // Present on `message` events. "im" = 1:1 DM with the bot, "channel" =
  // public channel, "group" = private channel, "mpim" = multi-person DM.
  // We only act on "im" for the message event type; channels go through
  // the app_mention pathway instead.
  channel_type?: string;
  // link_shared-only fields: list of URLs Slack found in the message and
  // the message ts they appeared in. `channel` above carries the channel.
  // `unfurl_id` and `source` are present too but we don't use them — they
  // matter only for advanced cases like updating an unfurl after posting.
  links?: Array<{ url: string; domain?: string }>;
  message_ts?: string;
  source?: string;
  unfurl_id?: string;
}

// Logical surface within Slack — drives mention-stripping, threading, the
// channel allowlist, and which background handler we dispatch to. Returns
// null if the event isn't one we handle.
type SlackKind = 'channel_mention' | 'dm' | 'link_shared';

function classifySlackEvent(event: SlackInnerEvent | undefined): SlackKind | null {
  if (!event) return null;
  if (event.type === 'app_mention') return 'channel_mention';
  if (event.type === 'link_shared') return 'link_shared';
  if (
    event.type === 'message' &&
    event.channel_type === 'im' &&
    // Only fresh user messages — skip edits ("message_changed"), deletes
    // ("message_deleted"), bot echoes ("bot_message"), file shares, etc.
    // Slack's DM event stream is noisier than app_mention's.
    !event.subtype
  ) {
    return 'dm';
  }
  return null;
}

interface ChatMessageRow {
  role: string;
  content: string;
}

export async function POST(req: NextRequest) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET ?? '';
  const botToken = process.env.SLACK_BOT_TOKEN ?? '';
  if (!signingSecret || !botToken) {
    console.error('[slack] missing SLACK_SIGNING_SECRET or SLACK_BOT_TOKEN');
    // Return 200 anyway so Slack doesn't disable the URL on misconfig —
    // but log loudly so it's easy to diagnose.
    return new Response(null, { status: 200 });
  }

  // We need the raw body string to verify the signature. NextRequest gives
  // us text() which is the bytes Slack sent. Don't read req.json() first —
  // that would consume the stream and we'd have nothing to hash.
  const rawBody = await req.text();
  const sig = req.headers.get('x-slack-signature');
  const ts = req.headers.get('x-slack-request-timestamp');

  const verified = verifySlackSignature(rawBody, sig, ts, signingSecret);
  if (!verified.ok) {
    console.warn('[slack] signature verification failed', {
      reason: verified.reason,
    });
    return new Response('signature verification failed', { status: 401 });
  }

  let envelope: SlackEventEnvelope;
  try {
    envelope = JSON.parse(rawBody) as SlackEventEnvelope;
  } catch {
    return new Response('invalid json', { status: 400 });
  }

  // 1) URL verification: Slack sends this once when wiring up the
  //    Request URL on the Event Subscriptions page. We have to echo
  //    back the challenge string verbatim to prove we own the URL.
  if (envelope.type === 'url_verification' && envelope.challenge) {
    return NextResponse.json({ challenge: envelope.challenge });
  }

  // 2) Dedup: Slack retries when we don't ack within 3s. Returning early
  //    on a retried event_id avoids double-running the agent.
  if (alreadyProcessed(envelope.event_id)) {
    return new Response(null, { status: 200 });
  }

  // 3) Classify the event. We act on @-mentions in channels and on direct
  //    messages to the bot. Anything else (joins, edits, reactions, etc.)
  //    we ack and drop on the floor.
  const event = envelope.event;
  const kind = classifySlackEvent(event);
  if (!event || !kind) {
    return new Response(null, { status: 200 });
  }

  // 4) Ignore bot-authored messages so we never reply to ourselves or
  //    other bots (which would either spam loop or just be noise).
  //    link_shared is exempt: those events don't always carry `user`
  //    (they identify the message's author via the underlying post),
  //    and we DO want to unfurl URLs that humans paste — even when the
  //    paste happens via another bot like a bookmark integration.
  if (
    kind !== 'link_shared' &&
    (event.bot_id || event.subtype === 'bot_message' || !event.user)
  ) {
    return new Response(null, { status: 200 });
  }

  // 5) Optional channel allowlist — ONLY applies to channel mentions.
  //    DMs are inherently 1:1 and the user already proved access by being
  //    in your workspace, so applying a channel filter to them would be
  //    confusing (the "channel" id of a DM is a synthetic D… id anyway).
  //    link_shared is also exempt: unfurls are passive (no agent runs,
  //    nothing is persisted, no external systems are touched), so the
  //    privacy concerns that motivate the allowlist don't apply.
  if (kind === 'channel_mention') {
    const allowedRaw = process.env.SLACK_ALLOWED_CHANNELS ?? '';
    const allowedChannels = allowedRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (
      allowedChannels.length > 0 &&
      event.channel &&
      !allowedChannels.includes(event.channel)
    ) {
      console.log('[slack] event from non-allowlisted channel; ignoring', {
        channel: event.channel,
      });
      return new Response(null, { status: 200 });
    }
  }

  // Defer the actual work: ack now (Slack's 3s SLA), then process.
  // `after` runs the callback after the response is sent and works on both
  // Vercel and self-hosted Node. Errors here must NOT propagate or Slack
  // will see a 500 even though we already 200'd; wrap in try/catch.
  after(async () => {
    try {
      if (kind === 'link_shared') {
        await handleLinkShared(event, botToken);
      } else {
        await handleSlackMessage(event, kind, botToken);
      }
    } catch (err) {
      console.error('[slack] background handler threw', { kind, err });
    }
  });

  return new Response(null, { status: 200 });
}

async function handleSlackMessage(
  event: SlackInnerEvent,
  kind: Exclude<SlackKind, 'link_shared'>,
  botToken: string,
): Promise<void> {
  if (!event.user || !event.channel || !event.ts) return;

  const web = new WebClient(botToken);

  // Resolve identities first. Without an app user we can't pull history,
  // can't persist, and shouldn't run the agent (memory is keyed by user).
  const [identity, botUserId] = await Promise.all([
    resolveSlackUser(web, event.user),
    getBotUserId(web),
  ]);

  // Threading rules:
  //   channel_mention → reply in-thread; if the mention itself isn't in a
  //                     thread we anchor a new one on the mention's ts so
  //                     conversation doesn't pollute the channel.
  //   dm              → undefined; Slack DMs don't really do threads, and
  //                     forcing one creates a weird collapsed UI.
  const threadTs =
    kind === 'channel_mention' ? (event.thread_ts ?? event.ts) : undefined;

  if (!identity) {
    await postReply(
      web,
      event.channel,
      threadTs,
      `Hey <@${event.user}> — I don't recognize this Slack account. Ask Billy to add your email to Foreshadow so I can connect you, then try again.`,
    );
    return;
  }

  // Channel mentions arrive as "<@U123BOT> do the thing"; we strip the
  // leading bot mention so the prompt the agent sees is just "do the thing".
  // DMs don't have that prefix — the user typed straight at the bot —
  // so we pass the raw text through.
  const rawText = event.text ?? '';
  const stripped = (
    kind === 'channel_mention' ? stripBotMention(rawText, botUserId) : rawText
  ).trim();

  // Resolve any remaining `<@Uxxx>` mentions of OTHER users to a
  // prompt-friendly `[Display Name] (user_id: <uuid>)` form. This lets
  // the agent answer "what's on Rae's plate?" without doing a fuzzy
  // find_users call — we already know exactly who Rae is. See
  // resolveMentionsInText for the resolution rules.
  const prompt = await resolveMentionsInText(web, stripped);

  if (!prompt) {
    await postReply(
      web,
      event.channel,
      threadTs,
      `Hi <@${event.user}> — what would you like me to look up?`,
    );
    return;
  }

  // Pull recent history from ai_chat_messages, same as the in-app route.
  // This means Slack and in-app share memory (a deliberate choice — see
  // chat thread). Per-thread / per-DM Slack scoping isn't built yet; if it
  // becomes needed we can layer a slack_thread_ts column onto the table
  // without breaking the in-app side.
  const history = await loadHistory(identity.appUserId);

  const supabase = getSupabaseServer();
  await supabase.from('ai_chat_messages').insert({
    user_id: identity.appUserId,
    role: 'user',
    content: prompt,
    metadata: {
      surface: 'slack',
      slack_kind: kind,
      slack_channel: event.channel,
      ...(threadTs ? { slack_thread_ts: threadTs } : {}),
      slack_user_id: event.user,
    },
  });

  // Slack runs the same agent loop as the in-app chat — same tools, same
  // preview/confirm dance for writes, same backstops. Surface-specific
  // bits: the formatting hint (Slack mrkdwn vs. full markdown) and the
  // resolved actor (we know exactly who's typing because email matched a
  // users row; in-app chat doesn't have real auth yet so it can't pass
  // an actor with the same confidence).
  const result = await runAgent({
    history,
    prompt,
    clientTz: identity.tz ?? undefined,
    surface: 'slack',
    actor: {
      appUserId: identity.appUserId,
      name: identity.appUserName,
      role: identity.role,
    },
  });

  const masked = applyBackstops(result.text, result.toolCalls);
  if (masked.writeMasked) {
    console.warn('[slack] masked hallucinated write claim', {
      user_id: identity.appUserId,
      slack_user: event.user,
      kind,
      original: masked.originalIfMasked,
    });
  }
  if (masked.readMasked) {
    console.warn('[slack] masked hallucinated read claim', {
      user_id: identity.appUserId,
      slack_user: event.user,
      kind,
      original: masked.originalIfMasked,
    });
  }

  // Scrub trailing inline metadata from any "- [Task](url) — Property | Date"
  // bullet lines BEFORE persistence. We deliberately persist the cleaned
  // version so it propagates into future conversation history (which the
  // model echoes); persisting the raw text would let the bad pattern
  // re-seed itself every turn. See stripTaskListMetadata for rationale.
  const finalText = stripTaskListMetadata(masked.text);

  await supabase.from('ai_chat_messages').insert({
    user_id: identity.appUserId,
    role: 'assistant',
    content: finalText,
    metadata: {
      surface: 'slack',
      slack_kind: kind,
      slack_channel: event.channel,
      ...(threadTs ? { slack_thread_ts: threadTs } : {}),
      tool_calls: result.toolCalls.map((c) => {
        const base = { name: c.name, input: c.input, ok: c.output.ok };
        return c.output.ok
          ? { ...base, meta: c.output.meta }
          : { ...base, error: c.output.error };
      }),
      ...(masked.writeMasked ? { masked_write_claim: true } : {}),
      ...(masked.readMasked ? { masked_read_claim: true } : {}),
    },
  });

  const mrkdwnText = markdownToMrkdwn(finalText);

  // Build task cards for any task URLs the agent linked to. We can't use
  // chat.unfurl for the bot's own messages — Slack doesn't fire
  // link_shared for posts where unfurl_links is false (which we keep off
  // to suppress noisy generic OG previews on other URLs the agent might
  // surface), so chat.unfurl returns 200 but silently drops the cards.
  // Carousel/attachments rendered inline on chat.postMessage don't
  // depend on the link_shared flow and render unconditionally.
  //
  // buildTaskMessageExtras decides between a horizontal carousel block
  // (≤10 tasks, the common case) and vertical attachments (>10 tasks,
  // since Slack caps carousels at 10 elements).
  const taskUrls = extractTaskUrlsFromText(mrkdwnText).map((url) => ({ url }));
  const extras = taskUrls.length > 0 ? await buildTaskMessageExtras(taskUrls) : {};

  await postReply(web, event.channel, threadTs, mrkdwnText, extras);
}

// Pure unfurl entry point. No agent, no persistence, no allowlist — just
// recognise our task URLs in the message Slack told us about and respond
// with Block Kit cards. See src/slack/unfurl.ts for the matching logic.
//
// Uses the event's unfurl_id + source pair (the modern chat.unfurl form),
// which Slack reliably renders across composer-preview, post-send, and
// conversations_history surfaces. The legacy channel + ts form silently
// no-ops for many of those contexts even when chat.unfurl returns 200.
async function handleLinkShared(
  event: SlackInnerEvent,
  botToken: string,
): Promise<void> {
  if (!event.links?.length) return;
  const web = new WebClient(botToken);
  await unfurlTaskLinksFromEvent(web, {
    channel: event.channel,
    message_ts: event.message_ts,
    unfurl_id: event.unfurl_id,
    source: event.source,
    links: event.links,
  });
}

async function loadHistory(appUserId: string): Promise<MessageParam[]> {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from('ai_chat_messages')
    .select('role, content')
    .eq('user_id', appUserId)
    .order('created_at', { ascending: false })
    .limit(MEMORY_WINDOW * 2);

  if (error || !data) return [];

  return (data as ChatMessageRow[])
    .reverse()
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
}

async function postReply(
  web: WebClient,
  channel: string,
  threadTs: string | undefined,
  text: string,
  extras: MessageExtras = {},
): Promise<void> {
  // When we render task cards in a `carousel` block, Slack uses the
  // `blocks` array for display and treats `text` purely as notification
  // fallback (it doesn't show in the conversation). Prepend a section
  // block carrying the same mrkdwn so the actual message body renders
  // above the carousel. For the attachments fallback (>10 tasks), the
  // top-level `text` field DOES render normally, so we don't need to
  // wrap it.
  const blocks =
    extras.blocks && extras.blocks.length > 0
      ? ([
          { type: 'section', text: { type: 'mrkdwn', text } },
          ...extras.blocks,
        ] as Block[])
      : undefined;

  try {
    await web.chat.postMessage({
      channel,
      // Only set thread_ts when we actually want to thread. For DMs we
      // omit it so the reply sits flat in the conversation.
      ...(threadTs ? { thread_ts: threadTs } : {}),
      text,
      ...(blocks ? { blocks } : {}),
      // Inline task-card attachments (only used as the >10-tasks
      // fallback, since carousels cap at 10 elements). When empty we
      // omit the field — Slack rejects empty attachments arrays as a
      // malformed payload in some clients.
      ...(extras.attachments && extras.attachments.length > 0
        ? { attachments: extras.attachments }
        : {}),
      // Disable Slack's auto-link unfurling so unrelated URLs the agent
      // might surface (wifi networks, doc links from property knowledge,
      // etc.) don't get generic OG-tag previews stacked under the
      // message. Our own task cards ride along in `blocks` /
      // `attachments` above, which doesn't depend on this flag.
      unfurl_links: false,
      unfurl_media: false,
    });
  } catch (err) {
    console.error('[slack] chat.postMessage failed', { channel, threadTs, err });
  }
}
