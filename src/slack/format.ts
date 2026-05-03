// Markdown ↔ Slack mrkdwn conversion.
//
// Slack uses "mrkdwn" — its own near-but-not-quite-markdown flavor. The
// agent's system prompt already nudges it toward Slack-friendly output
// when surface='slack', but the model still occasionally drops in
// **double-asterisk bold** or "## Heading" lines from training-data
// inertia. This module is the safety net that cleans those up before
// chat.postMessage delivers the message to a channel.
//
// Conversion rules (mrkdwn cheat-sheet):
//   - bold:    **x** → *x*    (single asterisks)
//   - italic:  *x*   → _x_    (underscores; mrkdwn's *x* is bold!)
//   - code:    `x`   → `x`    (unchanged)
//   - code block: ```x``` → ```x``` (unchanged)
//   - heading: ## x  → *x*    (no native heading; bold the line)
//   - link:    [t](u) → <u|t> (Slack's link syntax)
//
// Italic is intentionally NOT converted — the heuristic to distinguish
// "bold via *single*" vs "italic via *single*" needs context, and getting
// it wrong is worse than leaving italics as plain asterisks. The model
// rarely uses italic in this app anyway.

/**
 * Convert markdown produced by the LLM into Slack mrkdwn. Idempotent:
 * passing already-mrkdwn text through twice produces identical output
 * (so it's safe to apply on responses that may already be Slack-friendly).
 */
export function markdownToMrkdwn(input: string): string {
  let out = input;

  // Strip headings: replace `## Foo` (any level 1-6) at start of line with
  // `*Foo*`. We do this before bold conversion so the heading text becomes
  // properly bolded.
  out = out.replace(/^#{1,6}\s+(.+?)\s*$/gm, '*$1*');

  // Bold: `**foo**` → `*foo*`. Non-greedy match so adjacent bolds on the
  // same line don't merge. We require at least one non-asterisk character
  // inside so we don't accidentally turn `****` into `**`.
  out = out.replace(/\*\*([^*\n]+?)\*\*/g, '*$1*');

  // Markdown links: `[text](https://...)` → `<https://...|text>`. Only
  // matches http(s) and mailto links so we don't mangle reference-style
  // links or relative URLs (which wouldn't be useful in Slack anyway).
  out = out.replace(
    /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)/g,
    '<$2|$1>',
  );

  return out;
}

/**
 * Strip a leading "<@U123ABC>" mention (and any surrounding whitespace)
 * from a message. Used to clean the bot's own mention out of the prompt
 * before handing it to the agent — the agent doesn't need to see "<@U123>"
 * and the system prompt would just confuse it.
 *
 * Only strips the bot's own user id; other @-mentions in the message are
 * preserved (they're meaningful context).
 */
export function stripBotMention(text: string, botUserId: string | null): string {
  if (!botUserId) return text.trim();
  // The pattern matches "<@U123ABC>" optionally followed by whitespace.
  // Slack always uses angle brackets and the U-prefixed id, so this is
  // safe to do greedily at the start of the string.
  const re = new RegExp(`^\\s*<@${botUserId}>\\s*`, 'i');
  return text.replace(re, '').trim();
}

/**
 * Strip trailing inline metadata from bullet-list lines that consist of
 * a single linked task title.
 *
 * Why this exists: the Slack-specific system prompt instructs the model
 * to render task enumerations as bare linked titles ("- [Task](url)")
 * since the Block Kit cards we attach below the message already carry
 * status / property / due / priority. The model usually obeys, but the
 * conversation-memory window (loadHistory in the Slack route) feeds
 * prior assistant turns back in — and many of those turns predate the
 * "no inline metadata" rule and DO append " — Property | Date" tails.
 * In-context examples occasionally outweigh the system prompt, so the
 * model echoes the old format. This function is the deterministic
 * safety net that scrubs the tail regardless.
 *
 * Only acts on lines that:
 *   - start at column 0 of a line (the gm flag anchors per-line),
 *   - begin with a bullet marker `-` or `*` followed by whitespace,
 *   - have a markdown link `[text](http(s)?://...)` as the FIRST item
 *     after the bullet.
 *
 * Anything past the closing `)` of the link on that line is dropped.
 *
 * Anything else — single-task replies, free prose, lists without links,
 * lines where the link isn't the first element after the bullet — is
 * left alone so we don't over-trim.
 *
 * Idempotent: feeding the output back through is a no-op.
 */
export function stripTaskListMetadata(input: string): string {
  return input.replace(
    /^(\s*[-*]\s+\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))[^\n]*$/gm,
    '$1',
  );
}
