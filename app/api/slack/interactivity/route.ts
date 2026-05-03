import { NextRequest, NextResponse } from 'next/server';
import { verifySlackSignature } from '@/src/slack/verify';

// POST /api/slack/interactivity
//
// Slack Interactivity webhook. Slack POSTs every interactive click —
// button presses, modal submits, select-menu changes, etc. — to this
// URL when Interactivity & Shortcuts is enabled in the app's config.
//
// Why this exists today:
//   The /myassignments slash-command path (chat.postEphemeral + carousel
//   + URL button) needs Interactivity ENABLED for Slack's ephemeral
//   renderer to honour `button.url` clicks. The Slack docs spell this
//   out: a button with `url` "will still receive an interaction
//   payload and will need to send an acknowledgement response." On
//   non-ephemeral chat.postMessage Slack is lenient about the missing
//   ack, but on ephemeral the click is fully suppressed if the ack
//   never arrives. So this route's job, for now, is just to ack 200
//   on every interaction so URL navigation isn't blocked.
//
// What it doesn't do (yet):
//   Parse + dispatch the payload. There's no server-side button
//   behaviour wired up yet — the `open_task_*` action_id we set on
//   carousel cards is purely the URL-binding shim. When real
//   interactive features land (e.g. "Mark complete" from a task
//   card, or modal submissions for /createtask), the dispatch table
//   goes here. Today the route just verifies + 200s, which is the
//   minimum contract Slack requires.
//
// Slack app config (in api.slack.com/apps):
//   Interactivity & Shortcuts:
//     - Toggle ON.
//     - Request URL: https://<your-domain>/api/slack/interactivity
//     - Save. Slack will probe the URL with a synthetic POST as part
//       of saving; the route MUST be deployed and reachable BEFORE
//       you save the config or Slack will reject it.
//
// Required env (same as the events + commands routes):
//   SLACK_SIGNING_SECRET (used to verify the HMAC).
//
// Wire format:
//   Slack sends interaction payloads as application/x-www-form-urlencoded
//   with a single `payload` field whose value is a JSON-encoded string.
//   Some interaction types (block_actions, view_submission, view_closed,
//   shortcut, message_action) ship in this same envelope. We don't parse
//   it today (the verify+ack contract is the only requirement) but the
//   payload IS available to handlers that grow up here later.
//
// Lifecycle:
//   1. Read the raw body (Slack signs bytes-on-the-wire — same rule
//      as the events + commands routes).
//   2. Verify HMAC.
//   3. Return 200 with an empty body.

export async function POST(req: NextRequest) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET ?? '';
  if (!signingSecret) {
    console.error('[slack/interactivity] SLACK_SIGNING_SECRET not set');
    // 500 here would tell Slack we're broken, which is honest. We don't
    // fall back to 200 because that would silently accept unverifiable
    // requests in a misconfigured deploy.
    return NextResponse.json(
      { error: 'Slack integration is not configured' },
      { status: 500 },
    );
  }

  // Slack signs the raw body bytes. We MUST read the body as text once
  // and reuse it for both verification and (eventually) parsing —
  // letting Next parse the form would change the byte ordering and
  // break the HMAC.
  const rawBody = await req.text();

  const verify = verifySlackSignature(
    rawBody,
    req.headers.get('x-slack-signature'),
    req.headers.get('x-slack-request-timestamp'),
    signingSecret,
  );
  if (!verify.ok) {
    console.warn('[slack/interactivity] signature verification failed', {
      reason: verify.reason,
    });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // No-op ack. When real handlers land we'll parse the payload here:
  //
  //   const params = new URLSearchParams(rawBody);
  //   const payload = JSON.parse(params.get('payload') ?? '{}');
  //   switch (payload.type) {
  //     case 'block_actions': ...
  //     case 'view_submission': ...
  //   }
  //
  // For now Slack only needs the 200 for URL-button navigation to
  // proceed in ephemeral context.
  return new NextResponse(null, { status: 200 });
}
