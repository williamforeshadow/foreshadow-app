import crypto from 'node:crypto';
import type { UpdateTaskInput } from './updateTask';

// In-memory confirmation-token store for the update_task write tool.
// Mirror of createTaskConfirmation — see that file for the limitations
// and upgrade path. Single-use, 5-minute TTL.

interface TokenEntry {
  input: UpdateTaskInput;
  expiresAtMs: number;
}

const TOKENS = new Map<string, TokenEntry>();
const TOKEN_TTL_MS = 5 * 60 * 1000;

export interface MintedToken {
  token: string;
  expires_at: string;
}

export type ConsumeOutcome =
  | { ok: true; input: UpdateTaskInput }
  | { ok: false; reason: 'unknown' | 'expired' };

function pruneExpired(now: number): void {
  for (const [token, entry] of TOKENS) {
    if (entry.expiresAtMs <= now) {
      TOKENS.delete(token);
    }
  }
}

export function mintUpdateTaskToken(input: UpdateTaskInput): MintedToken {
  const now = Date.now();
  pruneExpired(now);
  const token = crypto.randomUUID();
  const expiresAtMs = now + TOKEN_TTL_MS;
  TOKENS.set(token, { input, expiresAtMs });
  return { token, expires_at: new Date(expiresAtMs).toISOString() };
}

export function consumeUpdateTaskToken(token: string): ConsumeOutcome {
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
