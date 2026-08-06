import { WebClient } from '@slack/web-api';
import { getBotUserId, resolveMentionsInText } from './identity';
import { stripBotMention } from './format';

// Slack thread reader.
//
// When the bot is @-mentioned mid-thread (e.g. someone in a long
// support thread tags @Foreshadow with "summarize this and create a
// task"), the @-mention text alone is rarely enough context. This
// helper pulls the surrounding thread via conversations.replies,
// resolves user mentions to display names, and returns a plain-text
// transcript the agent can read as ambient context.
//
// REQUIRED Slack scopes (configured in api.slack.com/apps; see
// app/api/slack/events/route.ts for the full scope inventory):
//   channels:history   — public channels the bot is a member of
//   groups:history     — private channels (the bot must be invited)
//   mpim:history       — multi-party DMs (rare; nice to have)
//   im:history         — DMs (already required for direct DM handling)
//
// If the scopes aren't granted, conversations.replies returns
// missing_scope (or not_in_channel for channels the bot isn't in). We
// catch and return an empty list rather than failing the whole event
// — the agent can still answer the @-mention text alone.
//
// What gets excluded, and why it is NOT "everything the bot said":
//   This used to drop every bot-authored message, on the assumption that
//   stored memory already covered them. That holds for the agent's own
//   replies and nothing else — the bot also posts assignment cards, daily
//   outlooks (src/server/automations/*) and notification cards
//   (src/server/notifications/notify.ts), none of which touch
//   ai_chat_messages. So a thread hanging off an assignment card fed the
//   agent the human's "can you reschedule this one?" with the card itself
//   filtered out from under it.
//
//   The exclusion is now what is ACTUALLY already in the replayed history,
//   passed in as `seenMessageTs` (see loadReplayedHistory in
//   src/server/agent/memory.ts). Bot-authored was only ever a proxy for
//   that. A message the agent posted and remembers is skipped; a message it
//   posted from some other code path, or one that has aged out of the replay
//   window, comes through as context.
//
// Token budget:
//   Threads can be enormous in busy channels, so message count and
//   per-message length are both capped. Note this block rides in the LAST
//   message of the request, which changes every turn — so unlike the system
//   prompt and tool schemas, it is re-sent at full price on every turn rather
//   than being served from the prompt cache. Raising either cap raises the
//   per-turn cost directly. The @-mention message itself (the prompt the
//   agent is already responding to) is excluded so we don't double-feed.

export interface ThreadMessage {
  /** Display name of the author, or "(unknown)" when we can't resolve it. */
  authorName: string;
  /** Message timestamp (ISO-ish). Useful when the agent wants to relay timing. */
  ts: string;
  /** Plain text with `<@Uxxx>` mentions resolved and bot-mentions stripped. */
  text: string;
}

export interface FetchThreadOptions {
  /** Channel id the thread lives in. */
  channel: string;
  /** Thread root ts (event.thread_ts; or event.ts for the parent post itself). */
  threadTs: string;
  /**
   * Message ts of the @-mention that triggered this fetch. Excluded from
   * the returned transcript so we don't feed the agent its own prompt twice.
   */
  excludeTs?: string;
  /**
   * Slack ts of every message already being replayed as conversation history.
   * Those are skipped here so each message reaches the model once, as a real
   * turn rather than as a duplicate line of ambient text.
   *
   * Omit it and nothing is skipped — the whole thread comes through, which is
   * the safe direction to fail.
   */
  seenMessageTs?: Set<string>;
  /** Cap on returned messages. Older messages get trimmed first. Default 20. */
  maxMessages?: number;
  /** Cap on per-message text length (chars). Truncated with an ellipsis. Default 800. */
  maxCharsPerMessage?: number;
}

// 100 rather than 20: the case this reader exists for is the bot being pulled
// into a thread that has already been running, and 20 was routinely less than
// the conversation it was meant to explain. 100 is also the largest single
// page conversations.replies will return, so it is the most context available
// without paging on next_cursor.
//
// In practice a turn sees fewer than 100: everything already replayed as real
// history is filtered out below, which is the point — the reader supplies the
// remainder, not a second copy.
const DEFAULT_MAX_MESSAGES = 100;
const DEFAULT_MAX_CHARS_PER_MESSAGE = 800;

/** How the bot's own posts are attributed in the transcript. */
const BOT_AUTHOR_LABEL = 'Foreshadow (you, posted earlier)';

interface SlackReplyMessage {
  type?: string;
  subtype?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  ts?: string;
}

/**
 * Pull the messages in a thread (minus the triggering @-mention and anything
 * already in the replayed history), resolve their `<@Uxxx>` mentions, and
 * return a tidy transcript suitable for prompt injection.
 *
 * Returns an empty array on ANY failure (missing scope, not in channel,
 * thread not found, network blip, etc.) and logs the cause. This is
 * intentional: a missing thread context shouldn't break the user's
 * @-mention reply; the agent can still operate on the prompt alone.
 */
export async function fetchThreadMessages(
  web: WebClient,
  opts: FetchThreadOptions,
): Promise<ThreadMessage[]> {
  const maxMessages = opts.maxMessages ?? DEFAULT_MAX_MESSAGES;
  const maxChars = opts.maxCharsPerMessage ?? DEFAULT_MAX_CHARS_PER_MESSAGE;

  let raw: SlackReplyMessage[];
  try {
    // Slack pagination: a thread can have arbitrary replies, but for
    // prompt injection we only want the most recent N. We pull a
    // single page (up to 100, the API max) and trim — sufficient for
    // realistic threads, and avoids the cost of paging through 1000+
    // messages when we'd discard most of them.
    const res = await web.conversations.replies({
      channel: opts.channel,
      ts: opts.threadTs,
      // One page. The cushion over maxMessages covers messages the filter
      // below will drop (already-in-history, empties, joins), but it is
      // clamped at 100 — the page ceiling — so at the default maxMessages
      // there is no cushion left and a very long thread yields its most
      // recent 100 rather than its whole self. Going past that means paging
      // on next_cursor, which is a deliberate non-goal for now: the token
      // cost of a thread block is paid on EVERY turn, since it rides in the
      // last message and the cache cannot hold it across turns.
      limit: Math.min(100, Math.max(maxMessages * 4, 50)),
    });
    raw = (res.messages ?? []) as SlackReplyMessage[];
  } catch (err) {
    // Most common in practice: missing_scope (the channel-history
    // scopes weren't granted), not_in_channel (the bot isn't a
    // member), or thread_not_found (race with a deletion). Log the
    // payload so it's debuggable without re-running the request.
    console.warn('[slack/thread] conversations.replies failed', {
      channel: opts.channel,
      threadTs: opts.threadTs,
      err,
    });
    return [];
  }

  if (raw.length === 0) return [];

  // Resolve our own bot user id once — used to label the bot's own posts and
  // to strip self-mentions below. No longer used to exclude them; see the
  // header for why bot-authored stopped being the filter.
  const botUserId = await getBotUserId(web).catch(() => null);

  const isBotAuthored = (m: SlackReplyMessage) =>
    !!m.bot_id || (!!botUserId && m.user === botUserId);

  // Filter:
  //   - drop the @-mention message itself (the agent already has it)
  //   - drop anything already in the replayed history (it reaches the model
  //     as a real conversation turn; a second copy here would be noise)
  //   - drop subtypes that aren't real conversation (channel_join,
  //     message_deleted, etc.). file_share stays: an assignment card posted
  //     with an attachment is exactly the kind of root message a thread
  //     hangs off, and the events route treats file_share as real too.
  //   - drop empties. Result attachments post with no top-level text, so
  //     this quietly covers the confirm/cancel outcome messages — which are
  //     in stored history anyway.
  const filtered = raw.filter((m) => {
    if (m.ts === opts.excludeTs) return false;
    if (m.ts && opts.seenMessageTs?.has(m.ts)) return false;
    if (m.subtype && m.subtype !== 'thread_broadcast' && m.subtype !== 'file_share') {
      return false;
    }
    if (!m.text || m.text.trim().length === 0) return false;
    return true;
  });

  // Take the LAST maxMessages — recent context wins — except that the thread
  // ROOT is never what you want to drop. It is the message the whole thread is
  // a reply to, and since bot posts stopped being filtered out (see the header)
  // it is frequently the assignment card or daily outlook the conversation
  // hangs off. Ageing that out of a busy thread would throw away the one
  // message that explains all the others.
  //
  // It replaces the oldest of the recent window rather than extending it, so
  // the cap still means what it says.
  let trimmed = filtered.slice(-maxMessages);
  const root = filtered.find((m) => m.ts === opts.threadTs);
  if (root && !trimmed.includes(root)) {
    trimmed = [root, ...trimmed.slice(1)];
  }

  // Resolve mentions and authors in parallel where possible. We need a
  // user→name lookup for each unique author too — easiest path is to
  // build a Slack-id→display-name map by calling resolveMentionsInText
  // on a synthetic `<@Uxxx>` token for each author. That way we get
  // the same caching behaviour and never spam users.info.
  // The bot's own posts are labelled directly below, so they're kept out of
  // the resolver — it maps Slack ids to FORESHADOW users, and the bot isn't
  // one. Left in, every automation card would read "Slack user U123BOT".
  const uniqueAuthorIds = Array.from(
    new Set(
      trimmed
        .filter((m) => !isBotAuthored(m))
        .map((m) => m.user)
        .filter((u): u is string => !!u),
    ),
  );

  // Build "Author1 / Author2 / …" lookup tokens, run them through the
  // shared resolver, then parse the resulting "[Name] (user_id: …)"
  // back into a Slack-id→name map. Slightly cute but it lets us reuse
  // the existing code path without spelunking into resolveSlackUser.
  const authorNameById = new Map<string, string>();
  if (uniqueAuthorIds.length > 0) {
    const tokens = uniqueAuthorIds.map((id) => `<@${id}>`).join(' ');
    const resolved = await resolveMentionsInText(web, tokens);
    // Pattern: [Display Name] (user_id: <uuid>) per author, separated
    // by spaces. Matches whatever resolveMentionsInText emitted.
    const pattern = /\[([^\]]+)\]\s+\(user_id:\s+[^)]+\)/g;
    const matches = Array.from(resolved.matchAll(pattern));
    matches.forEach((m, i) => {
      const slackId = uniqueAuthorIds[i];
      if (slackId && m[1]) {
        authorNameById.set(slackId, m[1]);
      }
    });
    // Any author that didn't resolve (no app user match) gets a
    // fallback derived from the original token; resolveMentionsInText
    // leaves those as `<@Uxxx>` literally, so look for those too.
    const literalPattern = /<@([UW][A-Z0-9]+)>/g;
    for (const m of resolved.matchAll(literalPattern)) {
      const slackId = m[1];
      if (slackId && !authorNameById.has(slackId)) {
        authorNameById.set(slackId, `Slack user ${slackId}`);
      }
    }
  }

  // Produce final ThreadMessage objects. Mention resolution + bot-
  // mention stripping per-message: same pipeline the @-mention prompt
  // already goes through, so the model sees thread context formatted
  // identically to what it sees as the user prompt.
  const out: ThreadMessage[] = [];
  for (const m of trimmed) {
    const authorId = m.user ?? '';
    // Anything reaching here that the bot wrote is a post it does NOT have in
    // memory — an assignment card, a daily outlook, a notification. Naming it
    // as the assistant is what lets the model recognise the thing the humans
    // in the thread are replying to as its own.
    const authorName = isBotAuthored(m)
      ? BOT_AUTHOR_LABEL
      : (authorNameById.get(authorId) ?? '(unknown)');
    let text = m.text ?? '';
    if (botUserId) text = stripBotMention(text, botUserId);
    text = await resolveMentionsInText(web, text);
    text = text.trim();
    if (text.length > maxChars) {
      text = text.slice(0, maxChars - 1) + '…';
    }
    if (text.length === 0) continue;
    out.push({ authorName, ts: m.ts ?? '', text });
  }

  return out;
}

/**
 * Render a ThreadMessage[] as a single block of plain text suitable
 * for prepending to the user's prompt. Stable, deterministic format
 * so the agent can be told ("the block tagged 'Thread context' is
 * background, not the new user request") and reliably distinguish
 * the two.
 *
 * Returns an empty string when given an empty list, so the caller can
 * unconditionally call this and skip injection only when the result is
 * empty.
 */
export function formatThreadAsContext(messages: ThreadMessage[]): string {
  if (messages.length === 0) return '';
  const lines = messages.map(
    (m) => `- ${m.authorName}: ${m.text}`,
  );
  return [
    'Thread context (oldest first; this is background, not the new request).',
    `Lines from "${BOT_AUTHOR_LABEL}" are messages you posted into this thread` +
      ' from elsewhere in Foreshadow — an assignment card, a daily outlook, a' +
      ' notification. They are not in your conversation history, so treat them' +
      ' as things you said that you would otherwise have no record of:',
    ...lines,
  ].join('\n');
}
