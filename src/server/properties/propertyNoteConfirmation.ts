import crypto from 'node:crypto';
import type { UpsertNoteInput } from './upsertPropertyNote';
import type { DeleteNoteInput } from './deletePropertyNote';

// In-memory confirmation-token stores for property note write tools.
//
// Two independent stores so a token minted by preview_property_note_upsert
// cannot accidentally satisfy commit_property_note_delete (and vice versa).
// 5-minute TTL, single-use, same shape as createTaskConfirmation. See
// src/server/tasks/createTaskConfirmation.ts for the upgrade path.

const TOKEN_TTL_MS = 5 * 60 * 1000;

interface UpsertEntry {
  input: UpsertNoteInput;
  expiresAtMs: number;
}
interface DeleteEntry {
  input: DeleteNoteInput;
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

export function mintUpsertNoteToken(input: UpsertNoteInput): MintedToken {
  const now = Date.now();
  pruneExpired(UPSERT_TOKENS, now);
  const token = crypto.randomUUID();
  const expiresAtMs = now + TOKEN_TTL_MS;
  UPSERT_TOKENS.set(token, { input, expiresAtMs });
  return { token, expires_at: new Date(expiresAtMs).toISOString() };
}

export function consumeUpsertNoteToken(
  token: string,
): ConsumeOutcome<UpsertNoteInput> {
  const now = Date.now();
  pruneExpired(UPSERT_TOKENS, now);
  const entry = UPSERT_TOKENS.get(token);
  if (!entry) return { ok: false, reason: 'unknown' };
  UPSERT_TOKENS.delete(token);
  if (entry.expiresAtMs <= now) return { ok: false, reason: 'expired' };
  return { ok: true, input: entry.input };
}

export function mintDeleteNoteToken(input: DeleteNoteInput): MintedToken {
  const now = Date.now();
  pruneExpired(DELETE_TOKENS, now);
  const token = crypto.randomUUID();
  const expiresAtMs = now + TOKEN_TTL_MS;
  DELETE_TOKENS.set(token, { input, expiresAtMs });
  return { token, expires_at: new Date(expiresAtMs).toISOString() };
}

export function consumeDeleteNoteToken(
  token: string,
): ConsumeOutcome<DeleteNoteInput> {
  const now = Date.now();
  pruneExpired(DELETE_TOKENS, now);
  const entry = DELETE_TOKENS.get(token);
  if (!entry) return { ok: false, reason: 'unknown' };
  DELETE_TOKENS.delete(token);
  if (entry.expiresAtMs <= now) return { ok: false, reason: 'expired' };
  return { ok: true, input: entry.input };
}
