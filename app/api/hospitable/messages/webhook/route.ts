import { NextResponse, after } from 'next/server';
import {
  resolveHospitableIntegrationByWebhookSecret,
  hospitableCredsFor,
} from '@/lib/pmsIntegrations';
import { ingestHospitableThread } from '@/src/server/messages/ingestHospitable';

// Hospitable message webhook receiver (message.created — fires for BOTH guest
// and host messages). Hospitable webhooks carry no signature, so the tenant is
// selected by a per-integration secret in the URL
// (…/api/hospitable/messages/webhook?secret=<pms_integrations.webhook_secret>).
// We resolve the org, ack fast, and sync the reservation's full thread off the
// response path (idempotent; the thread pull covers both directions).

export const maxDuration = 60;

function extractSecret(request: Request): string | null {
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get('secret');
  if (fromQuery) return fromQuery;
  const auth = request.headers.get('authorization') ?? '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

// Pull the reservation uuid from the message.created payload. Defensive about
// the wrapper shape (confirmed against a real webhook once registered).
function extractReservationId(payload: any): string | null {
  return (
    payload?.data?.reservation_id ??
    payload?.reservation_id ??
    payload?.data?.reservation?.id ??
    payload?.data?.message?.reservation_id ??
    null
  );
}

export async function POST(request: Request) {
  const secret = extractSecret(request);
  const integration = secret
    ? await resolveHospitableIntegrationByWebhookSecret(secret)
    : null;
  if (!integration) {
    return new Response('unauthorized', { status: 401 });
  }

  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return new Response('invalid json', { status: 400 });
  }

  const reservationUuid = extractReservationId(payload);
  if (!reservationUuid) {
    console.warn('[Hospitable Webhook] no reservation_id in payload', {
      keys: Object.keys(payload ?? {}),
    });
    return NextResponse.json({ ok: true, ignored: 'no_reservation_id' });
  }

  const orgId = integration.org_id;
  const creds = hospitableCredsFor(integration);

  after(async () => {
    try {
      await ingestHospitableThread({ creds, orgId }, String(reservationUuid), { realtime: true });
    } catch (err) {
      console.error('[Hospitable Webhook] thread sync failed', { reservationUuid, err });
    }
  });

  return NextResponse.json({ ok: true });
}

// Health check so the URL is verifiable in a browser.
export async function GET() {
  return NextResponse.json({ ok: true });
}
