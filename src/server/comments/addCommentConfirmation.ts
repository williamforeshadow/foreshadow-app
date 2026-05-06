import crypto from 'node:crypto';
import type { AddCommentInput } from './addComment';

// In-memory confirmation-token store for the add_comment write tool.
//
// Same shape as createTaskConfirmation: tokens minted by preview_comment,
// consumed by add_comment, single-use, 5-minute TTL. See the comment in
// src/server/tasks/createTaskConfirmation.ts for the limitations and the
// upgrade path; this store inherits them.

interface TokenEntry {
  input: AddCommentInput;
  expiresAtMs: number;
}

const TOKENS = new Map<string, TokenEntry>();
const TOKEN_TTL_MS = 5 * 60 * 1000;

export interface MintedToken {
  token: string;
  expires_at: string;
}

export type ConsumeOutcome =
  | { ok: true; input: AddCommentInput }
  | { ok: false; reason: 'unknown' | 'expired' };

function pruneExpired(now: number): void {
  for (const [token, entry] of TOKENS) {
    if (entry.expiresAtMs <= now) {
      TOKENS.delete(token);
    }
  }
}

export function mintAddCommentToken(input: AddCommentInput): MintedToken {
  const now = Date.now();
  pruneExpired(now);
  const token = crypto.randomUUID();
  const expiresAtMs = now + TOKEN_TTL_MS;
  TOKENS.set(token, { input, expiresAtMs });
  return { token, expires_at: new Date(expiresAtMs).toISOString() };
}

export function consumeAddCommentToken(token: string): ConsumeOutcome {
  const now = Date.now();
  pruneExpired(now);
  const entry = TOKENS.get(token);
  if (!entry) return { ok: false, reason: 'unknown' };
  TOKENS.delete(token);
  if (entry.expiresAtMs <= now) return { ok: false, reason: 'expired' };
  return { ok: true, input: entry.input };
}

export function _peekTokenCount(): number {
  pruneExpired(Date.now());
  return TOKENS.size;
}
