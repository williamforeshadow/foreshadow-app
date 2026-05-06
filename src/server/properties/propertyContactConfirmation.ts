import crypto from 'node:crypto';
import type { UpsertContactInput } from './upsertPropertyContact';
import type { DeleteContactInput } from './deletePropertyContact';

// In-memory confirmation-token stores for property contact write tools.
// Two independent stores; same TTL/single-use semantics as the note
// stores. See src/server/tasks/createTaskConfirmation.ts for the upgrade
// path.

const TOKEN_TTL_MS = 5 * 60 * 1000;

interface UpsertEntry {
  input: UpsertContactInput;
  expiresAtMs: number;
}
interface DeleteEntry {
  input: DeleteContactInput;
  expiresAtMs: number;
}

const UPSERT_TOKENS = new Map<string, UpsertEntry>();
const DELETE_TOKENS = new Map<string, DeleteEntry>();

export interface MintedToken {
  token: string;
  expires_at: string;
}

export type ConsumeOutcome<T> =
  | { ok: true; input: T }
  | { ok: false; reason: 'unknown' | 'expired' };

function pruneExpired<T extends { expiresAtMs: number }>(
  store: Map<string, T>,
  now: number,
): void {
  for (const [k, v] of store) {
    if (v.expiresAtMs <= now) store.delete(k);
  }
}

export function mintUpsertContactToken(input: UpsertContactInput): MintedToken {
  const now = Date.now();
  pruneExpired(UPSERT_TOKENS, now);
  const token = crypto.randomUUID();
  const expiresAtMs = now + TOKEN_TTL_MS;
  UPSERT_TOKENS.set(token, { input, expiresAtMs });
  return { token, expires_at: new Date(expiresAtMs).toISOString() };
}

export function consumeUpsertContactToken(
  token: string,
): ConsumeOutcome<UpsertContactInput> {
  const now = Date.now();
  pruneExpired(UPSERT_TOKENS, now);
  const entry = UPSERT_TOKENS.get(token);
  if (!entry) return { ok: false, reason: 'unknown' };
  UPSERT_TOKENS.delete(token);
  if (entry.expiresAtMs <= now) return { ok: false, reason: 'expired' };
  return { ok: true, input: entry.input };
}

export function mintDeleteContactToken(input: DeleteContactInput): MintedToken {
  const now = Date.now();
  pruneExpired(DELETE_TOKENS, now);
  const token = crypto.randomUUID();
  const expiresAtMs = now + TOKEN_TTL_MS;
  DELETE_TOKENS.set(token, { input, expiresAtMs });
  return { token, expires_at: new Date(expiresAtMs).toISOString() };
}

export function consumeDeleteContactToken(
  token: string,
): ConsumeOutcome<DeleteContactInput> {
  const now = Date.now();
  pruneExpired(DELETE_TOKENS, now);
  const entry = DELETE_TOKENS.get(token);
  if (!entry) return { ok: false, reason: 'unknown' };
  DELETE_TOKENS.delete(token);
  if (entry.expiresAtMs <= now) return { ok: false, reason: 'expired' };
  return { ok: true, input: entry.input };
}
