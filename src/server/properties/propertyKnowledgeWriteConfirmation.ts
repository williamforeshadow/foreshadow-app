import crypto from 'node:crypto';
import type { PropertyKnowledgeWriteInput } from './propertyKnowledgeWrite';

const TOKEN_TTL_MS = 5 * 60 * 1000;

interface Entry {
  input: PropertyKnowledgeWriteInput;
  expiresAtMs: number;
}

const TOKENS = new Map<string, Entry>();

export interface MintedToken {
  token: string;
  expires_at: string;
}

export type ConsumeOutcome =
  | { ok: true; input: PropertyKnowledgeWriteInput }
  | { ok: false; reason: 'unknown' | 'expired' };

function pruneExpired(now: number): void {
  for (const [token, entry] of TOKENS) {
    if (entry.expiresAtMs <= now) TOKENS.delete(token);
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
