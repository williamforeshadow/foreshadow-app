import crypto from 'node:crypto';
import type { AddCommentInput } from './addComment';
import type { AddCommentsBatchInput } from './addCommentsBatch';

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

interface BatchTokenEntry {
  input: AddCommentsBatchInput;
  expiresAtMs: number;
}

const TOKENS = new Map<string, TokenEntry>();
// Separate store so a single-comment token can never be redeemed against the
// batch commit tool, or vice versa — they carry different input shapes.
const BATCH_TOKENS = new Map<string, BatchTokenEntry>();
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
  for (const [token, entry] of BATCH_TOKENS) {
    if (entry.expiresAtMs <= now) {
      BATCH_TOKENS.delete(token);
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

export type ConsumeBatchOutcome =
  | { ok: true; input: AddCommentsBatchInput }
  | { ok: false; reason: 'unknown' | 'expired' };

export function mintAddCommentsBatchToken(
  input: AddCommentsBatchInput,
): MintedToken {
  const now = Date.now();
  pruneExpired(now);
  const token = crypto.randomUUID();
  const expiresAtMs = now + TOKEN_TTL_MS;
  BATCH_TOKENS.set(token, { input, expiresAtMs });
  return { token, expires_at: new Date(expiresAtMs).toISOString() };
}

export function consumeAddCommentsBatchToken(
  token: string,
): ConsumeBatchOutcome {
  const now = Date.now();
  pruneExpired(now);
  const entry = BATCH_TOKENS.get(token);
  if (!entry) return { ok: false, reason: 'unknown' };
  BATCH_TOKENS.delete(token);
  if (entry.expiresAtMs <= now) return { ok: false, reason: 'expired' };
  return { ok: true, input: entry.input };
}
