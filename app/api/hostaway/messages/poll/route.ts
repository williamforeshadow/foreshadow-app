import { NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/requireCronAuth';
import { pollOutboundChanges } from '@/src/server/messages/pollOutbound';
import { listActiveIntegrations, hostawayCredsFor } from '@/lib/pmsIntegrations';

// Every-minute cron — detects host-sent messages that reached Hostaway without
// reaching us.
//
// Schedule is `* * * * *` in vercel.json. Hostaway webhooks only fire for
// inbound guest messages, so this is the only thing that notices a reply typed
// in the Hostaway dashboard, or a Hostaway automation firing, inside the minute.
// The decision logic — and the reasoning for why one list call is enough — lives
// in pollOutbound.ts; this route supplies the clock and the tenant loop.
//
// Cost per tick is one Hostaway list call per active integration (~0.5s,
// ~150 KB) and, at observed volume, zero thread pulls in the typical minute.
//
// The org loop is SEQUENTIAL. That is right at today's integration count and
// wrong at hundreds — the fan-out wants bounded concurrency, and the per-account
// token cache in lib/hostaway.ts wants to move to the database (tokens are valid
// for two years, but the in-memory Map dies with each serverless instance, so a
// cold tick re-authenticates). Both are scale work, deliberately deferred: one
// slow org must not be able to starve the rest, which is why a thrown poll is
// contained per-org below rather than failing the whole tick.
//
// GET delegates to POST so it can be fired manually from a browser.

export const maxDuration = 60;

export async function POST(request: Request) {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  const ranAt = new Date().toISOString();

  try {
    const integrations = await listActiveIntegrations('hostaway');
    if (integrations.length === 0) {
      return NextResponse.json({ ran_at: ranAt, skipped: 'no_integration' });
    }

    const orgs: Record<string, unknown>[] = [];
    for (const integration of integrations) {
      try {
        const result = await pollOutboundChanges({
          creds: hostawayCredsFor(integration),
          orgId: integration.org_id,
        });
        orgs.push({ org_id: integration.org_id, ...result });
      } catch (err) {
        // One org's Hostaway being down, rate-limited, or mis-credentialed must
        // not stop the others from syncing.
        console.error('[messages poll] org tick failed', { orgId: integration.org_id, err });
        orgs.push({
          org_id: integration.org_id,
          error: err instanceof Error ? err.message : 'unknown',
        });
      }
    }

    return NextResponse.json({
      ran_at: ranAt,
      orgs_polled: orgs.length,
      ingested: orgs.reduce((n, o) => n + ((o.ingested as number) ?? 0), 0),
      orgs,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[messages poll] Error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
