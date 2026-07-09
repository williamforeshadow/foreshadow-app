import { createHmac } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// RLS-governed Supabase client for a KNOWN app user on a session-less server
// path (e.g. the Slack agent surface, where there is no browser session to
// reuse). Mints a short-lived HS256 JWT with the user's auth_user_id as `sub`,
// so `auth.uid()` resolves inside Postgres and the org_isolation RLS policies
// scope every query to the user's org(s) — enforced by the database, not by
// per-query `.eq('org_id', …)` discipline.
//
// This is the structural multi-tenant guardrail: code holding this client
// CANNOT read or write another org's rows even if it forgets to filter.
// (Explicit org filters in callers remain as defense-in-depth.)
//
// Web request paths should NOT use this — they already have the user's real
// session; use requireAuthContext()'s `supabase` instead.
//
// Verified against the live DB (2026-07-08): a token minted this way returned
// only the user's org's rows and returned zero rows for another org's ids.

const TOKEN_TTL_SECONDS = 10 * 60; // one agent run, with headroom

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

/** Mint a short-lived Supabase-compatible JWT for an auth user id. */
export function mintUserJwt(authUserId: string): string {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    throw new Error('SUPABASE_JWT_SECRET is not set — cannot mint a user-scoped token');
  }
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      sub: authUserId,
      role: 'authenticated',
      aud: 'authenticated',
      iss: 'supabase',
      iat: now,
      exp: now + TOKEN_TTL_SECONDS,
    }),
  );
  const signature = createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

/**
 * Create an RLS-governed client acting as the given auth user. Throws when the
 * JWT secret is unavailable — callers should fall back to the service client
 * ONLY where their queries carry explicit org filters.
 */
export function createSupabaseAsUser(authUserId: string): SupabaseClient {
  const token = mintUserJwt(authUserId);
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}
