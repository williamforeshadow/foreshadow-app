// Comment @-mention tokens.
//
// Wire/storage format, inline in project_comments.comment_content:
//
//   @[Display Name](6f1c9f2e-8f3a-4bfa-9c0e-1a2b3c4d5e6f)
//
// The display name is a denormalized snapshot at mention time (so old
// comments render sensibly even if a user is renamed or deleted); the uuid
// is the users.id and is what actually identifies the mention. The server
// re-validates every uuid against the actor's org before storing/notifying —
// a token with a foreign or unknown uuid is treated as plain text.
//
// This module is client-safe (no server imports): the Phase 2 composer and
// renderer share the exact same grammar as the server-side parser.

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

// Name: 1-80 chars, no ']' or newline (keeps the token single-line and
// unambiguous to parse).
export const MENTION_TOKEN_RE = new RegExp(
  `@\\[([^\\]\\n]{1,80})\\]\\((${UUID})\\)`,
  'g',
);

export interface MentionToken {
  /** users.id of the mentioned user (unvalidated at parse time). */
  userId: string;
  /** Display name embedded in the token. */
  name: string;
  /** Character offsets of the whole token within the source text. */
  start: number;
  end: number;
}

/** Extract every well-formed mention token, in document order. */
export function parseMentionTokens(text: string): MentionToken[] {
  const tokens: MentionToken[] = [];
  for (const m of text.matchAll(MENTION_TOKEN_RE)) {
    tokens.push({
      name: m[1],
      userId: m[2].toLowerCase(),
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return tokens;
}

/** Unique mentioned user ids, in first-appearance order. */
export function mentionedUserIds(text: string): string[] {
  return [...new Set(parseMentionTokens(text).map((t) => t.userId))];
}

/**
 * Collapse mention tokens to a plain "@Name" for any surface that renders
 * raw text: notification previews, Slack/push copy, activity log lines.
 */
export function stripMentionTokens(text: string): string {
  return text.replace(MENTION_TOKEN_RE, '@$1');
}

/** Serialize a mention for insertion into comment text (composer side). */
export function formatMentionToken(user: { id: string; name: string }): string {
  const safeName = user.name.replace(/[\]\n]/g, ' ').slice(0, 80).trim() || 'Unknown';
  return `@[${safeName}](${user.id})`;
}
