import { NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/requireCronAuth';
import { backfillRecentConversations } from '@/src/server/messages/ingest';
import { getPrimaryHostawayIntegration, hostawayCredsFor } from '@/lib/pmsIntegrations';

// One-time backfill: build canonical `conversations` rows for every existing
// thread (recent Hostaway conversations + all known). Large cap to cover all.
// Manually triggerable (GET) like /api/hostaway/sync.
export const maxDuration = 300;

export async function POST(request: Request) {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  try {
    const integration = await getPrimaryHostawayIntegration();
    if (!integration) {
      return NextResponse.json({ success: true, skipped: 'no_integration' });
    }
    const ctx = { creds: hostawayCredsFor(integration), orgId: integration.org_id };
    const result = await backfillRecentConversations(ctx, 10000);
    return NextResponse.json({ success: true, ...result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Backfill Conversations] Error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
