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
// Token budget:
//   Threads can be enormous in busy channels. We cap message count and
//   per-message length so the prompt doesn't blow past MAX_TOKENS. The
//   bot's own messages and the @-mention message itself (the prompt the
//   agent is already responding to) are excluded so we don't double-feed.

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
  /** Cap on returned messages. Older messages get trimmed first. Default 20. */
  maxMessages?: number;
  /** Cap on per-message text length (chars). Truncated with an ellipsis. Default 800. */
  maxCharsPerMessage?: number;
}

const DEFAULT_MAX_MESSAGES = 20;
const DEFAULT_MAX_CHARS_PER_MESSAGE = 800;

interface SlackReplyMessage {
  type?: string;
  subtype?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  ts?: string;
}

/**
 * Pull the messages in a thread (excluding bot-authored ones and the
 * triggering @-mention itself), resolve their `<@Uxxx>` mentions, and
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
      // Pull ~enough that even after dropping bot/excluded messages we
      // still have maxMessages left. 4x cushion handles chat-heavy
      // threads where half the entries are the bot.
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

  // Resolve our own bot user id once so we can filter out bot-authored
  // messages even when bot_id isn't set (some integrations post as a
  // user with bot_id absent).
  const botUserId = await getBotUserId(web).catch(() => null);

  // Filter:
  //   - drop the @-mention message itself (the agent already has it)
  //   - drop bot-authored messages (echoes / our own prior replies)
  //   - drop subtypes that aren't real conversation (channel_join,
  //     message_deleted, file_share without text, etc.)
  const filtered = raw.filter((m) => {
    if (m.ts === opts.excludeTs) return false;
    if (m.bot_id) return false;
    if (botUserId && m.user === botUserId) return false;
    if (m.subtype && m.subtype !== 'thread_broadcast') return false;
    if (!m.text || m.text.trim().length === 0) return false;
    return true;
  });

  // Take the LAST maxMessages (most recent context wins).
  const trimmed = filtered.slice(-maxMessages);

  // Resolve mentions and authors in parallel where possible. We need a
  // user→name lookup for each unique author too — easiest path is to
  // build a Slack-id→display-name map by calling resolveMentionsInText
  // on a synthetic `<@Uxxx>` token for each author. That way we get
  // the same caching behaviour and never spam users.info.
  const uniqueAuthorIds = Array.from(
    new Set(trimmed.map((m) => m.user).filter((u): u is string => !!u)),
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
    const authorName = authorNameById.get(authorId) ?? '(unknown)';
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
    'Thread context (oldest first; this is background, not the new request):',
    ...lines,
  ].join('\n');
}
