import crypto from 'node:crypto';
import type { CreateBinInput } from './createBin';

// In-memory confirmation-token store for the bin write flow.
//
// Mirrors createTaskConfirmation.ts exactly — same TTL, same single-use
// semantics, same prune-on-read strategy. Kept as a separate module so
// the two domains (bins and tasks) don't accidentally share token-space
// (a stale task token consumed against create_bin would otherwise look
// like a perfectly valid foreign body).
//
// See the long preamble in createTaskConfirmation.ts for the security /
// upgrade-path rationale; everything there applies here too.

interface TokenEntry {
  input: CreateBinInput;
  expiresAtMs: number;
}

const TOKENS = new Map<string, TokenEntry>();
const TOKEN_TTL_MS = 5 * 60 * 1000;

export interface MintedToken {
  token: string;
  expires_at: string;
}

export type ConsumeOutcome =
  | { ok: true; input: CreateBinInput }
  | { ok: false; reason: 'unknown' | 'expired' };

function pruneExpired(now: number): void {
  for (const [token, entry] of TOKENS) {
    if (entry.expiresAtMs <= now) {
      TOKENS.delete(token);
    }
  }
}

export function mintCreateBinToken(input: CreateBinInput): MintedToken {
  const now = Date.now();
  pruneExpired(now);

  const token = crypto.randomUUID();
  const expiresAtMs = now + TOKEN_TTL_MS;
  TOKENS.set(token, { input, expiresAtMs });

  return { token, expires_at: new Date(expiresAtMs).toISOString() };
}

export function consumeCreateBinToken(token: string): ConsumeOutcome {
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
