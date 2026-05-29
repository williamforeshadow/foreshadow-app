// Direct APNs sender — talks to Apple's push gateway over HTTP/2 with
// token-based (.p8) auth. No third-party push vendor: notification content
// never leaves our stack, and per-event cost scales linearly with the small
// fan-out of our targeted task notifications.
//
// Env vars (set in Vercel):
//   APNS_KEY        full contents of the APNs Auth Key .p8 file
//   APNS_KEY_ID     the Key ID for that key
//   APNS_TEAM_ID    Apple Developer Team ID
//   APNS_BUNDLE_ID  app bundle id (apns-topic), e.g. com.foreshadow.ios
//
// The send loop is deliberately self-contained and side-effect-isolated
// (every failure is caught + logged, never thrown into the notification path)
// so it can later be lifted into a queue worker unchanged if fan-out grows.

import http2 from 'node:http2';
import { SignJWT, importPKCS8 } from 'jose';
import { getSupabaseServer } from '@/lib/supabaseServer';

type ApnsEnvironment = 'production' | 'sandbox';

const APNS_HOSTS: Record<ApnsEnvironment, string> = {
  production: 'https://api.push.apple.com',
  sandbox: 'https://api.sandbox.push.apple.com',
};

interface DeviceTokenRow {
  id: string;
  token: string;
  environment: ApnsEnvironment;
}

interface ApnsCredentials {
  key: string;
  keyId: string;
  teamId: string;
  bundleId: string;
}

function readCredentials(): ApnsCredentials | null {
  const key = process.env.APNS_KEY;
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const bundleId = process.env.APNS_BUNDLE_ID;
  if (!key || !keyId || !teamId || !bundleId) {
    return null;
  }
  // Vercel env-var inputs often store the .p8 with literal "\n" instead of
  // real newlines; importPKCS8 needs a valid PEM block.
  return { key: key.replace(/\\n/g, '\n'), keyId, teamId, bundleId };
}

// APNs provider tokens are valid for up to 1h and must not be refreshed more
// than ~once/20min. Cache and rotate at ~50min to stay comfortably inside both
// bounds across many sends.
const JWT_TTL_MS = 50 * 60 * 1000;
let cachedJwt: { token: string; expiresAt: number } | null = null;

async function getProviderJwt(creds: ApnsCredentials): Promise<string> {
  const now = Date.now();
  if (cachedJwt && cachedJwt.expiresAt > now) {
    return cachedJwt.token;
  }
  const privateKey = await importPKCS8(creds.key, 'ES256');
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: creds.keyId })
    .setIssuer(creds.teamId)
    .setIssuedAt()
    .sign(privateKey);
  cachedJwt = { token, expiresAt: now + JWT_TTL_MS };
  return token;
}

interface ApnsResult {
  status: number;
  reason: string | null;
}

function postToApns(args: {
  host: string;
  deviceToken: string;
  jwt: string;
  bundleId: string;
  payload: Record<string, unknown>;
}): Promise<ApnsResult> {
  const { host, deviceToken, jwt, bundleId, payload } = args;
  return new Promise<ApnsResult>((resolve) => {
    const client = http2.connect(host);
    let settled = false;
    const finish = (result: ApnsResult) => {
      if (settled) return;
      settled = true;
      try {
        client.close();
      } catch {
        // ignore — connection may already be tearing down
      }
      resolve(result);
    };

    client.on('error', () => finish({ status: 0, reason: 'ConnectionError' }));

    const body = Buffer.from(JSON.stringify(payload));
    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${deviceToken}`,
      authorization: `bearer ${jwt}`,
      'apns-topic': bundleId,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'content-type': 'application/json',
      'content-length': body.length,
    });
    req.setTimeout(10_000, () => {
      req.close();
      finish({ status: 0, reason: 'Timeout' });
    });

    let status = 0;
    let data = '';
    req.on('response', (headers) => {
      status = Number(headers[':status']) || 0;
    });
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('error', () => finish({ status: 0, reason: 'RequestError' }));
    req.on('end', () => {
      let reason: string | null = null;
      if (data) {
        try {
          reason = (JSON.parse(data) as { reason?: string }).reason ?? null;
        } catch {
          reason = null;
        }
      }
      finish({ status, reason });
    });

    req.write(body);
    req.end();
  });
}

async function deleteToken(tokenId: string): Promise<void> {
  try {
    await getSupabaseServer().from('device_tokens').delete().eq('id', tokenId);
  } catch (err) {
    console.warn('[apns] failed to prune dead token', {
      tokenId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function updateTokenEnvironment(
  tokenId: string,
  environment: ApnsEnvironment,
): Promise<void> {
  try {
    await getSupabaseServer()
      .from('device_tokens')
      .update({ environment, updated_at: new Date().toISOString() })
      .eq('id', tokenId);
  } catch {
    // best-effort — the next successful send will have set it anyway
  }
}

function otherEnv(env: ApnsEnvironment): ApnsEnvironment {
  return env === 'production' ? 'sandbox' : 'production';
}

export interface PushMessage {
  title: string;
  body: string;
  href?: string | null;
  notificationId?: string | null;
}

function buildPayload(message: PushMessage): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    aps: {
      alert: { title: message.title, body: message.body },
      sound: 'default',
    },
  };
  if (message.href) payload.href = message.href;
  if (message.notificationId) payload.notification_id = message.notificationId;
  return payload;
}

/**
 * Send one push to one device token, with environment fallback + dead-token
 * pruning. A token registered against the wrong APNs host (common when the
 * same .p8 serves both Xcode-debug "sandbox" and TestFlight "production"
 * builds) returns BadDeviceToken; we retry the other host once and, on
 * success, correct the stored environment. Unregistered tokens (410) are
 * pruned. Never throws.
 */
async function sendToToken(
  row: DeviceTokenRow,
  creds: ApnsCredentials,
  payload: Record<string, unknown>,
): Promise<void> {
  const jwt = await getProviderJwt(creds);
  const attempt = (env: ApnsEnvironment) =>
    postToApns({
      host: APNS_HOSTS[env],
      deviceToken: row.token,
      jwt,
      bundleId: creds.bundleId,
      payload,
    });

  let env = row.environment;
  let result = await attempt(env);

  // Wrong-host symptom → try the other environment once.
  if (result.reason === 'BadDeviceToken') {
    const fallback = otherEnv(env);
    const retry = await attempt(fallback);
    if (retry.status === 200) {
      await updateTokenEnvironment(row.id, fallback);
      return;
    }
    env = fallback;
    result = retry;
  }

  if (result.status === 200) {
    return;
  }
  if (
    result.status === 410 ||
    result.reason === 'Unregistered' ||
    result.reason === 'BadDeviceToken'
  ) {
    await deleteToken(row.id);
    return;
  }
  console.warn('[apns] push failed', {
    tokenId: row.id,
    environment: env,
    status: result.status,
    reason: result.reason,
  });
}

/**
 * Deliver a push to every device a user has registered. Best-effort: loads
 * the user's tokens and sends to each, swallowing all errors so push delivery
 * can never break the in-app / Slack notification path.
 */
export async function pushToUser(
  userId: string,
  message: PushMessage,
): Promise<void> {
  const creds = readCredentials();
  if (!creds) {
    // APNs not configured (e.g. local dev, or before the keys are set in
    // Vercel). Silently no-op so notifications still work everywhere else.
    return;
  }

  let tokens: DeviceTokenRow[] = [];
  try {
    const { data, error } = await getSupabaseServer()
      .from('device_tokens')
      .select('id, token, environment')
      .eq('user_id', userId);
    if (error) {
      console.warn('[apns] token lookup failed', { userId, error });
      return;
    }
    tokens = (data ?? []) as DeviceTokenRow[];
  } catch (err) {
    console.warn('[apns] token lookup threw', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  if (tokens.length === 0) return;

  const payload = buildPayload(message);
  await Promise.all(
    tokens.map((row) =>
      sendToToken(row, creds, payload).catch((err) => {
        console.warn('[apns] send threw', {
          tokenId: row.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }),
    ),
  );
}
