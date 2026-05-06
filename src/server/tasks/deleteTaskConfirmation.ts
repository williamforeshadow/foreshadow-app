import crypto from 'node:crypto';
import type { DeleteTaskInput } from './deleteTask';

// In-memory confirmation-token store for the delete_task write tool.
// Mirror of createTaskConfirmation; single-use, 5-minute TTL.
//
// Especially important for delete: the action is destructive and
// (today) hard. The token contract guarantees the model can't fire a
// delete without the user explicitly confirming the preview, and it
// can't reuse a token to delete twice.

interface TokenEntry {
  input: DeleteTaskInput;
  expiresAtMs: number;
}

const TOKENS = new Map<string, TokenEntry>();
const TOKEN_TTL_MS = 5 * 60 * 1000;

export interface MintedToken {
  token: string;
  expires_at: string;
}

export type ConsumeOutcome =
  | { ok: true; input: DeleteTaskInput }
  | { ok: false; reason: 'unknown' | 'expired' };

function pruneExpired(now: number): void {
  for (const [token, entry] of TOKENS) {
    if (entry.expiresAtMs <= now) {
      TOKENS.delete(token);
    }
  }
}

export function mintDeleteTaskToken(input: DeleteTaskInput): MintedToken {
  const now = Date.now();
  pruneExpired(now);
  const token = crypto.randomUUID();
  const expiresAtMs = now + TOKEN_TTL_MS;
  TOKENS.set(token, { input, expiresAtMs });
  return { token, expires_at: new Date(expiresAtMs).toISOString() };
}

export function consumeDeleteTaskToken(token: string): ConsumeOutcome {
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
