import crypto from 'node:crypto';
import type { PropertyKnowledgeWriteInput } from './propertyKnowledgeWrite';
import type { PropertyKnowledgeBatchInput } from './propertyKnowledgeWriteBatch';

const TOKEN_TTL_MS = 5 * 60 * 1000;

interface Entry {
  input: PropertyKnowledgeWriteInput;
  expiresAtMs: number;
}

interface BatchEntry {
  input: PropertyKnowledgeBatchInput;
  expiresAtMs: number;
}

const TOKENS = new Map<string, Entry>();
// Separate map, so a single-write token can never be redeemed against the batch
// commit tool (or vice versa) — the two carry different input shapes and the
// system prompt already promises tokens aren't interchangeable across pairs.
const BATCH_TOKENS = new Map<string, BatchEntry>();

export interface MintedToken {
  token: string;
  expires_at: string;
}

export type ConsumeOutcome =
  | { ok: true; input: PropertyKnowledgeWriteInput }
  | { ok: false; reason: 'unknown' | 'expired' };

export type ConsumeBatchOutcome =
  | { ok: true; input: PropertyKnowledgeBatchInput }
  | { ok: false; reason: 'unknown' | 'expired' };

function pruneExpired(now: number): void {
  for (const [token, entry] of TOKENS) {
    if (entry.expiresAtMs <= now) TOKENS.delete(token);
  }
  for (const [token, entry] of BATCH_TOKENS) {
    if (entry.expiresAtMs <= now) BATCH_TOKENS.delete(token);
  }
}

export function mintPropertyKnowledgeWriteToken(
  input: PropertyKnowledgeWriteInput,
): MintedToken {
  const now = Date.now();
  pruneExpired(now);
  const token = crypto.randomUUID();
  const expiresAtMs = now + TOKEN_TTL_MS;
  TOKENS.set(token, { input, expiresAtMs });
  return { token, expires_at: new Date(expiresAtMs).toISOString() };
}

export function consumePropertyKnowledgeWriteToken(
  token: string,
): ConsumeOutcome {
  const now = Date.now();
  pruneExpired(now);
  const entry = TOKENS.get(token);
  if (!entry) return { ok: false, reason: 'unknown' };
  TOKENS.delete(token);
  if (entry.expiresAtMs <= now) return { ok: false, reason: 'expired' };
  return { ok: true, input: entry.input };
}

export function mintPropertyKnowledgeBatchToken(
  input: PropertyKnowledgeBatchInput,
): MintedToken {
  const now = Date.now();
  pruneExpired(now);
  const token = crypto.randomUUID();
  const expiresAtMs = now + TOKEN_TTL_MS;
  BATCH_TOKENS.set(token, { input, expiresAtMs });
  return { token, expires_at: new Date(expiresAtMs).toISOString() };
}

export function consumePropertyKnowledgeBatchToken(
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
