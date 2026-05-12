import type { NextRequest } from 'next/server';

// Server-side actor extraction.
//
// Property knowledge HTTP routes read the acting user's id from the
// `x-actor-user-id` request header. Header rather than body because:
//   1. DELETE requests don't have a natural body
//   2. Body fields pollute every route's input schema
//   3. Headers are easy to grep/audit and trivially set by a fetch wrapper
//
// The header is supplied by the web client via lib/apiFetch.ts. When
// the user is unauthenticated (or the wrapper isn't used), the header
// is absent and we return null — every consumer must tolerate a null
// actor and fall back to "unattributed" logging.
//
// NOTE: this does NOT validate that the id exists in the users table.
// Consumers that care can do their own FK lookup; the existing
// project_activity precedent doesn't validate either.

const ACTOR_HEADER = 'x-actor-user-id';

export function getActorUserIdFromRequest(req: NextRequest | Request): string | null {
  const raw = req.headers.get(ACTOR_HEADER);
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  return trimmed;
}

export const ACTOR_HEADER_NAME = ACTOR_HEADER;
