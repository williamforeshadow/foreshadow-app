import { WebClient } from '@slack/web-api';
import { getSupabaseServer } from '@/lib/supabaseServer';

// Slack identity → app identity mapping.
//
// Slack events arrive with a Slack user id ("U123ABC"), but every other
// part of our system (chat memory, audit logs, write attribution) keys
// off our own users.id UUID. This module is the seam between the two.
//
// The mapping route is: Slack user id → users.info → email → users table.
// We require the Slack `users:read.email` scope for this to work; without
// it, profile.email is undefined and we can't link the account.
//
// Identities are cached in-memory per process for 10 minutes. Slack
// profiles change rarely, and mismatches are recoverable (worst case the
// user types again a minute later); a short TTL is plenty.

export interface ResolvedIdentity {
  /** Our users.id UUID. */
  appUserId: string;
  /** Slack user id (Uxxxxx). */
  slackUserId: string;
  /** Display name from Slack profile, useful for logging. */
  displayName: string | null;
  /** IANA tz from Slack profile (e.g. "America/Los_Angeles"); null if unknown. */
  tz: string | null;
}

interface CacheEntry {
  expiresAtMs: number;
  // null = looked up but no app user matches; we cache the negative result
  // so we don't hammer Slack + Supabase on every retry from the same user.
  identity: ResolvedIdentity | null;
}

const TTL_MS = 10 * 60 * 1000;
const NEGATIVE_TTL_MS = 60 * 1000; // shorter for misses so newly-onboarded users link quickly
const CACHE: Map<string, CacheEntry> = new Map(); // slackUserId -> entry

/**
 * Resolve a Slack user id to our app user. Returns null if the Slack user
 * has no matching email in our users table (or has no email visible to us).
 *
 * `web` is a Slack WebClient created by the caller (so we share one
 * client + bot token across the request lifecycle).
 */
export async function resolveSlackUser(
  web: WebClient,
  slackUserId: string,
): Promise<ResolvedIdentity | null> {
  const now = Date.now();
  const cached = CACHE.get(slackUserId);
  if (cached && cached.expiresAtMs > now) {
    return cached.identity;
  }

  let identity: ResolvedIdentity | null = null;
  try {
    const info = await web.users.info({ user: slackUserId });
    const profile = info.user?.profile;
    const email = profile?.email?.toLowerCase().trim();
    const displayName =
      profile?.display_name?.trim() ||
      profile?.real_name?.trim() ||
      info.user?.name ||
      null;
    const tz = info.user?.tz || null;

    if (email) {
      // Email is the join key. We treat it as case-insensitive — Slack
      // returns it in whatever case the user typed, but our users.email
      // column is lowercased on insert (and we lowercase the query value
      // here to match).
      const { data, error } = await getSupabaseServer()
        .from('users')
        .select('id')
        .ilike('email', email)
        .maybeSingle();
      if (!error && data?.id) {
        identity = {
          appUserId: data.id as string,
          slackUserId,
          displayName,
          tz,
        };
      }
    }
  } catch (err) {
    // users.info failed (e.g. missing scope, invalid_user). Cache the
    // negative result for the short TTL so a transient blip doesn't pin
    // the user out for 10 minutes.
    console.warn('[slack/identity] users.info failed', { slackUserId, err });
  }

  CACHE.set(slackUserId, {
    expiresAtMs: now + (identity ? TTL_MS : NEGATIVE_TTL_MS),
    identity,
  });
  return identity;
}

/**
 * Cache for our own bot's user id, used to (a) ignore self-mentions in
 * channels we're in, and (b) strip "@BotName" from the prompt before
 * sending it to the agent.
 */
let botUserIdCache: { value: string; expiresAtMs: number } | null = null;

export async function getBotUserId(web: WebClient): Promise<string | null> {
  const now = Date.now();
  if (botUserIdCache && botUserIdCache.expiresAtMs > now) {
    return botUserIdCache.value;
  }
  try {
    const auth = await web.auth.test();
    const id = auth.user_id;
    if (typeof id === 'string' && id.length > 0) {
      botUserIdCache = { value: id, expiresAtMs: now + TTL_MS };
      return id;
    }
  } catch (err) {
    console.warn('[slack/identity] auth.test failed', { err });
  }
  return null;
}
