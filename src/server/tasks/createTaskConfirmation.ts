import crypto from 'node:crypto';
import type { CreateTaskInput } from './createTask';

// In-memory confirmation-token store for write-tool flows.
//
// Tokens are minted by preview_task (which validates the user's intent and
// resolves display labels) and consumed by create_task (which performs
// the actual DB write). Single-use, 5-minute TTL.
//
// Why the model can't bypass preview: create_task accepts ONLY a token,
// not the task fields. The full canonical input is stored server-side
// against the token at preview time. The model has no surface to call
// create_task without first obtaining a token from preview_task.
//
// Limitations and the upgrade path:
//   - Process-local. A server restart wipes pending tokens (user just
//     re-confirms). Multi-instance deployments need a shared store;
//     swap the Map for a small DB-backed table when we get there.
//   - Unbounded in pathological cases (many preview calls with no
//     consumption). Lazy prune on every read keeps it well-behaved under
//     realistic load; we can add a hard cap later if needed.

interface TokenEntry {
  /** Canonical, Zod-parsed input the token was minted for. */
  input: CreateTaskInput;
  /** Epoch ms after which this token is no longer valid. */
  expiresAtMs: number;
}

const TOKENS = new Map<string, TokenEntry>();
const TOKEN_TTL_MS = 5 * 60 * 1000;

export interface MintedToken {
  token: string;
  expires_at: string;
}

export type ConsumeOutcome =
  | { ok: true; input: CreateTaskInput }
  | { ok: false; reason: 'unknown' | 'expired' };

/** Drop expired entries. Cheap to call on every operation. */
function pruneExpired(now: number): void {
  for (const [token, entry] of TOKENS) {
    if (entry.expiresAtMs <= now) {
      TOKENS.delete(token);
    }
  }
}

/**
 * Mint a single-use confirmation token bound to the given canonical input.
 * Caller must have already run the input through Zod to normalize so that
 * what the user confirmed is exactly what gets written.
 */
export function mintCreateTaskToken(input: CreateTaskInput): MintedToken {
  const now = Date.now();
  pruneExpired(now);

  const token = crypto.randomUUID();
  const expiresAtMs = now + TOKEN_TTL_MS;
  TOKENS.set(token, { input, expiresAtMs });

  return { token, expires_at: new Date(expiresAtMs).toISOString() };
}

/**
 * Consume a token. Returns the original canonical input on success. Always
 * single-use — the entry is removed regardless of outcome to defeat replay
 * attempts.
 */
export function consumeCreateTaskToken(token: string): ConsumeOutcome {
  const now = Date.now();
  pruneExpired(now);

  const entry = TOKENS.get(token);
  if (!entry) {
    return { ok: false, reason: 'unknown' };
  }
  // Always remove on consume — success or expired.
  TOKENS.delete(token);

  if (entry.expiresAtMs <= now) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, input: entry.input };
}

/** Test/diagnostic helper. Not used in production code paths. */
export function _peekTokenCount(): number {
  pruneExpired(Date.now());
  return TOKENS.size;
}
