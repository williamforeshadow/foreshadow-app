import crypto from 'node:crypto';

// Slack request signature verification.
//
// Slack signs every event payload with a timestamped HMAC-SHA256 keyed off
// our app's signing secret. Verifying it on every request is the only thing
// stopping anyone on the internet from POSTing fake "@-mention" events at
// our public URL and getting the bot to leak data or burn LLM quota.
//
// This implementation deliberately uses the raw request body string (not
// the parsed JSON) because Slack signs the bytes-on-the-wire — re-stringifying
// after JSON.parse can change whitespace and break the signature.
//
// Spec: https://api.slack.com/authentication/verifying-requests-from-slack

// Slack rejects requests older than ~5 minutes server-side; we mirror that
// here so a leaked signature can't be replayed indefinitely.
const MAX_AGE_SECONDS = 60 * 5;

export interface VerifyResult {
  ok: boolean;
  /** Human-readable reason when ok=false. Safe to log; never includes secrets. */
  reason?: string;
}

/**
 * Verify the X-Slack-Signature header against the raw request body.
 *
 * @param rawBody  Exact bytes Slack sent us (do NOT pass a re-stringified JSON).
 * @param signatureHeader  Value of the X-Slack-Signature header (e.g. "v0=abc...").
 * @param timestampHeader  Value of the X-Slack-Request-Timestamp header (unix seconds).
 * @param signingSecret    Slack signing secret from Basic Information page.
 */
export function verifySlackSignature(
  rawBody: string,
  signatureHeader: string | null,
  timestampHeader: string | null,
  signingSecret: string,
): VerifyResult {
  if (!signatureHeader || !timestampHeader) {
    return { ok: false, reason: 'missing slack headers' };
  }
  if (!signingSecret) {
    return { ok: false, reason: 'signing secret not configured' };
  }

  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) {
    return { ok: false, reason: 'malformed timestamp' };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - timestamp) > MAX_AGE_SECONDS) {
    return { ok: false, reason: 'timestamp outside replay window' };
  }

  // Slack's basestring format: "v0:{timestamp}:{body}". Hash with the
  // signing secret as the HMAC key, prefix with "v0=".
  const basestring = `v0:${timestamp}:${rawBody}`;
  const expected =
    'v0=' +
    crypto
      .createHmac('sha256', signingSecret)
      .update(basestring, 'utf8')
      .digest('hex');

  // timingSafeEqual requires equal-length buffers; bail early if not, so
  // we don't throw on a malformed header.
  const expectedBuf = Buffer.from(expected, 'utf8');
  const givenBuf = Buffer.from(signatureHeader, 'utf8');
  if (expectedBuf.length !== givenBuf.length) {
    return { ok: false, reason: 'signature length mismatch' };
  }

  if (!crypto.timingSafeEqual(expectedBuf, givenBuf)) {
    return { ok: false, reason: 'signature mismatch' };
  }
  return { ok: true };
}
