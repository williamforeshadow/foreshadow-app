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
  /**
   * Foreshadow display name from the users row (NOT the Slack profile name).
   * Used as the agent's "actor" name so prompts read naturally. Falls back
   * to displayName when the users row is missing the name (shouldn't happen
   * but the type is permissive).
   */
  appUserName: string;
  /** users.role — drives permission-related agent prompt hints. */
  role: 'superadmin' | 'manager' | 'staff';
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
      // here to match). We also pull `name` and `role` so callers
      // (notably the agent's actor block + slash-command handlers) don't
      // need a second round-trip just to render "you are <name>".
      const { data, error } = await getSupabaseServer()
        .from('users')
        .select('id, name, role')
        .ilike('email', email)
        .maybeSingle();
      if (!error && data?.id) {
        const role =
          data.role === 'superadmin' ||
          data.role === 'manager' ||
          data.role === 'staff'
            ? data.role
            : 'staff';
        identity = {
          appUserId: data.id as string,
          slackUserId,
          displayName,
          tz,
          appUserName:
            (typeof data.name === 'string' && data.name.trim()) ||
            displayName ||
            'Unknown user',
          role,
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

// ── Reverse lookup: app email → Slack user id ──────────────────────────
//
// The forward path (resolveSlackUser) runs Slack → email → users table.
// The daily outlook needs the opposite: given a Foreshadow user's email,
// find their Slack user id so we can DM them. `users.lookupByEmail` is
// the Slack Web API call for this; it requires the `users:read.email`
// scope (which we already need for the forward path).
//
// Cached identically to the forward path — 10 min positive, 1 min
// negative — keyed on lowercased email.

export interface SlackUserByEmail {
  slackUserId: string;
  displayName: string | null;
}

const EMAIL_CACHE: Map<string, { expiresAtMs: number; result: SlackUserByEmail | null }> = new Map();

/**
 * Look up a Slack user by their email address. Returns null when no
 * matching Slack account exists (or the email has no Slack profile
 * visible to the bot).
 */
export async function lookupSlackUserByEmail(
  web: WebClient,
  email: string,
): Promise<SlackUserByEmail | null> {
  const key = email.toLowerCase().trim();
  const now = Date.now();
  const cached = EMAIL_CACHE.get(key);
  if (cached && cached.expiresAtMs > now) return cached.result;

  let result: SlackUserByEmail | null = null;
  try {
    const resp = await web.users.lookupByEmail({ email: key });
    if (resp.user?.id) {
      const profile = resp.user.profile;
      result = {
        slackUserId: resp.user.id,
        displayName:
          profile?.display_name?.trim() ||
          profile?.real_name?.trim() ||
          resp.user.name ||
          null,
      };
    }
  } catch (err: unknown) {
    // users_not_found is expected when the app user isn't in Slack.
    const code = (err as { data?: { error?: string } })?.data?.error;
    if (code !== 'users_not_found') {
      console.warn('[slack/identity] lookupByEmail failed', { email: key, err });
    }
  }

  EMAIL_CACHE.set(key, {
    expiresAtMs: now + (result ? TTL_MS : NEGATIVE_TTL_MS),
    result,
  });
  return result;
}

// Match a Slack user mention token in message text. Slack ALWAYS encodes
// these as "<@Uxxxxx>" or "<@Uxxxxx|display name>" (the |display form
// shows up in older clients). The capturing group is the Slack user id.
// We deliberately accept the |display variant but DROP the display name —
// the display Slack already showed the user is irrelevant to the agent;
// what matters is which app user the token resolves to.
const SLACK_MENTION_RE = /<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g;

/**
 * Rewrite Slack `<@Uxxxx>` mentions in a message into a form the agent
 * can actually use: `[Display Name] (user_id: <uuid>)`.
 *
 * Why this exists: when a Slack user types `@Rae find me her open
 * tasks`, Slack delivers the literal string `<@U07ABC>` in `event.text`.
 * The agent has no way to interpret that token — it doesn't know the
 * users table is keyed on UUIDs, not Slack ids, and `find_users` doesn't
 * accept Slack ids. So the agent ends up calling `find_users` with the
 * wrong query (or worse, fabricating a UUID). Pre-resolving every
 * mention before the agent sees the prompt eliminates the round trip
 * AND grounds the agent on the exact user the human meant.
 *
 * Behavior:
 *   - Resolved mention → `[Display Name] (user_id: <uuid>)`. Brackets
 *     mirror the prompt-friendly form we use elsewhere; the explicit
 *     `user_id:` label leaves no ambiguity for the model.
 *   - Mention that resolves to a Slack user but no app user → falls
 *     back to `[Display Name]` (no user_id), so the agent at least has
 *     a name to relay back. The agent's grounding rules will steer it
 *     toward find_users for any tool call that needs the id.
 *   - Mention that doesn't even resolve to a Slack user (rare;
 *     usually means the bot can't see that user — different workspace
 *     or scope issue) → leave the original `<@U…>` token untouched.
 *     Better to surface the noise than to silently rewrite to garbage.
 *
 * The bot's own `<@Ubot>` mention is stripped earlier by `stripBotMention`
 * (channel-mention path); this helper runs after that, so it never sees
 * the bot id. If the bot id slips through (DM path with someone copy-
 * pasting), the resolution will succeed and produce `[Foreshadow] (user_id: …)`
 * — harmless because the agent won't call find_users on itself.
 */
export async function resolveMentionsInText(
  web: WebClient,
  text: string,
): Promise<string> {
  if (!text) return text;
  // Collect unique Slack user ids first so we resolve each at most once,
  // even if the user @-tagged the same person multiple times in one
  // message.
  const uniqueIds: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(SLACK_MENTION_RE)) {
    const id = match[1];
    if (id && !seen.has(id)) {
      seen.add(id);
      uniqueIds.push(id);
    }
  }
  if (uniqueIds.length === 0) return text;

  // Resolve in parallel — resolveSlackUser is cached, so the worst case
  // is N parallel users.info calls on first contact and zero thereafter.
  const resolved = await Promise.all(
    uniqueIds.map(async (slackId) => {
      try {
        const id = await resolveSlackUser(web, slackId);
        return [slackId, id] as const;
      } catch (err) {
        console.warn('[slack/identity] mention resolve failed', {
          slackId,
          err,
        });
        return [slackId, null] as const;
      }
    }),
  );
  const map = new Map(resolved);

  return text.replace(SLACK_MENTION_RE, (whole, slackId: string) => {
    const id = map.get(slackId);
    if (!id) return whole; // unresolved → leave original token
    const displayName = id.appUserName;
    return `[${displayName}] (user_id: ${id.appUserId})`;
  });
}
