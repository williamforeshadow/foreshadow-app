import crypto from 'node:crypto';
import type { CreateTasksBatchInput } from './createTasksBatch';

// In-memory confirmation-token store for the batch task write flow.
//
// Mirrors createTaskConfirmation.ts and createBinConfirmation.ts —
// same TTL, same single-use semantics, same prune-on-read strategy.
// Kept in its own module so a stale token from one domain (single
// task, bin, batch) can never be replayed against another's commit
// tool. The agent's input shape is structurally distinct so a wrong-
// domain consume would also fail Zod, but defense-in-depth is cheap.
//
// See createTaskConfirmation.ts for the security/upgrade rationale that
// applies equally here.

interface TokenEntry {
  input: CreateTasksBatchInput;
  expiresAtMs: number;
}

const TOKENS = new Map<string, TokenEntry>();
const TOKEN_TTL_MS = 5 * 60 * 1000;

export interface MintedToken {
  token: string;
  expires_at: string;
}

export type ConsumeOutcome =
  | { ok: true; input: CreateTasksBatchInput }
  | { ok: false; reason: 'unknown' | 'expired' };

function pruneExpired(now: number): void {
  for (const [token, entry] of TOKENS) {
    if (entry.expiresAtMs <= now) {
      TOKENS.delete(token);
    }
  }
}

export function mintCreateTasksBatchToken(
  input: CreateTasksBatchInput,
): MintedToken {
  const now = Date.now();
  pruneExpired(now);

  const token = crypto.randomUUID();
  const expiresAtMs = now + TOKEN_TTL_MS;
  TOKENS.set(token, { input, expiresAtMs });

  return { token, expires_at: new Date(expiresAtMs).toISOString() };
}

export function consumeCreateTasksBatchToken(token: string): ConsumeOutcome {
  const now = Date.now();
  pruneExpired(now);

  const entry = TOKENS.get(token);
  if (!entry) {
    return { ok: false, reason: 'unknown' };
  }
  TOKENS.delete(token);

  if (entry.expiresAtMs <= now) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, input: entry.input };
}

export function _peekTokenCount(): number {
  pruneExpired(Date.now());
  return TOKENS.size;
}
