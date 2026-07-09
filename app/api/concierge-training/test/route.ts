import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentAppUser } from '@/src/server/users/currentUser';
import {
  runConciergeTest,
  type TestMessage,
  type TestScenario,
} from '@/src/server/messages/testDraft';
import type { CanonicalChannel } from '@/lib/conversations';

const SCENARIOS: TestScenario[] = ['checked_in', 'upcoming', 'past', 'inquiry'];
const CHANNELS: CanonicalChannel[] = [
  'airbnb',
  'vrbo',
  'bookingcom',
  'expedia',
  'direct',
  'manual',
  'other',
];

export const maxDuration = 60;

// POST /api/concierge-training/test — concierge test harness. Runs the exact
// real-guest reply path against a synthetic thread (operator-chosen property +
// fake guest name + typed messages) and returns the reply. No database writes;
// the agent is not told it's a test. Operator-only (requires a linked profile).
export async function POST(request: NextRequest) {
  const { user, error: authError } = await getCurrentAppUser();
  if (authError === 'unauthenticated') {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }
  if (authError === 'unlinked' || !user) {
    return NextResponse.json(
      { error: 'No Foreshadow profile is linked to this account' },
      { status: 403 },
    );
  }
  // Org boundary: the test may only run against the operator's own org's
  // properties/settings.
  if (!user.org_id) {
    return NextResponse.json(
      { error: 'This account is not assigned to an organization' },
      { status: 403 },
    );
  }

  try {
    const body = await request.json();
    const propertyId = typeof body.property_id === 'string' ? body.property_id : '';
    const guestName = typeof body.guest_name === 'string' ? body.guest_name : '';
    const rawMessages = Array.isArray(body.messages) ? body.messages : [];

    if (!propertyId) {
      return NextResponse.json({ error: 'Select a property to test from.' }, { status: 400 });
    }

    const scenario: TestScenario = SCENARIOS.includes(body.scenario)
      ? body.scenario
      : 'checked_in';

    const channel: CanonicalChannel | null = CHANNELS.includes(body.channel)
      ? body.channel
      : null;

    const messages: TestMessage[] = rawMessages
      .filter((m: unknown): m is { role: unknown; text: unknown } => !!m && typeof m === 'object')
      .map((m: { role: unknown; text: unknown }) => ({
        role: m.role === 'host' ? 'host' : 'guest',
        text: typeof m.text === 'string' ? m.text : '',
      }));

    const result = await runConciergeTest({
      propertyId,
      orgId: user.org_id,
      guestName,
      scenario,
      messages,
      channel,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[concierge test] generation failed:', err);
    const message = err instanceof Error ? err.message : 'Failed to generate a reply';
    const status = /not found/i.test(message) ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
