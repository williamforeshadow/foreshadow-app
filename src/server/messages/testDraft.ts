import { getSupabaseServer } from '@/lib/supabaseServer';
import { generateGuestReplyDraftFromContext } from './draftReply';
import type { ConversationContext, StayWindow } from './conversationContext';
import type { ConversationRow, BookingState } from '@/lib/conversations';
import type { GuestMessageRecord } from '@/lib/messages';

// Concierge test harness. Builds a SYNTHETIC conversation context from an
// operator-chosen property + fake guest name + a stay scenario + a typed
// transcript, then runs the exact same generation path a real guest reply takes
// (generateGuestReplyDraftFromContext). Nothing is written to the database and
// no "this is a test" signal reaches the model — the agent cannot tell it's a
// test. The reply is what the concierge would send a real guest in that
// situation.

export type TestRole = 'guest' | 'host';

// The guest's relationship to a stay. Drives the synthetic dates so the model
// frames its reply correctly (a checked-in guest vs a prospect vs a past guest).
export type TestScenario = 'checked_in' | 'upcoming' | 'past' | 'inquiry';

export interface TestMessage {
  role: TestRole;
  text: string;
}

export interface RunConciergeTestInput {
  propertyId: string;
  guestName: string;
  scenario: TestScenario;
  messages: TestMessage[];
}

interface PropertyMeta {
  name: string | null;
  timezone: string | null;
}

/** Resolve a property's name + timezone; throws if the id doesn't exist. */
async function getPropertyMeta(propertyId: string): Promise<PropertyMeta> {
  const { data, error } = await getSupabaseServer()
    .from('properties')
    .select('name, timezone')
    .eq('id', propertyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Property not found');
  const row = data as { name: string | null; timezone: string | null };
  return { name: row.name ?? null, timezone: row.timezone ?? null };
}

/** Today's date (YYYY-MM-DD) in the property's timezone, so "checked in" etc. resolve correctly. */
function todayInTimezone(timezone: string | null): string {
  try {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** Add a day offset to a YYYY-MM-DD date (anchored at UTC noon to dodge DST edges). */
function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function nightsBetween(checkIn: string, checkOut: string): number {
  const a = Date.parse(`${checkIn}T00:00:00Z`);
  const b = Date.parse(`${checkOut}T00:00:00Z`);
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** Build the stay window + booking_state for a scenario, with dates relative to `today`. */
function buildScenario(scenario: TestScenario, today: string): {
  stay: StayWindow;
  bookingState: BookingState;
} {
  if (scenario === 'inquiry') {
    return {
      stay: { check_in: null, check_out: null, nights: null, booked: false },
      bookingState: 'inquiry',
    };
  }
  // Booked scenarios — typical short stay placed relative to today.
  let checkIn: string;
  let checkOut: string;
  if (scenario === 'checked_in') {
    checkIn = addDays(today, -2);
    checkOut = addDays(today, 3);
  } else if (scenario === 'upcoming') {
    checkIn = addDays(today, 7);
    checkOut = addDays(today, 10);
  } else {
    // past
    checkIn = addDays(today, -10);
    checkOut = addDays(today, -7);
  }
  return {
    stay: { check_in: checkIn, check_out: checkOut, nights: nightsBetween(checkIn, checkOut), booked: true },
    bookingState: 'booked',
  };
}

/**
 * Construct a synthetic ConversationContext for the chosen property + scenario,
 * then generate the concierge reply.
 */
export async function runConciergeTest(
  input: RunConciergeTestInput,
): Promise<{ reply: string }> {
  const guestName = input.guestName.trim() || 'the guest';
  const cleaned = input.messages
    .map((m) => ({ role: m.role, text: (m.text ?? '').trim() }))
    .filter((m) => m.text.length > 0);

  if (cleaned.length === 0) {
    throw new Error('Type a guest message to test a reply.');
  }

  const { name: propertyName, timezone } = await getPropertyMeta(input.propertyId);
  const today = todayInTimezone(timezone);
  const { stay, bookingState } = buildScenario(input.scenario, today);

  // Synthetic thread. sent_at is left null (treated as already-sent, never
  // future); the generator uses array order for the transcript, so we pass the
  // messages chronologically. ids are synthetic and never shown to the model.
  const nowIso = new Date().toISOString();
  const messages: GuestMessageRecord[] = cleaned.map((m, i) => ({
    id: `test-${i}`,
    reservation_id: null,
    hostaway_conversation_id: null,
    hostaway_message_id: `test-${i}`,
    property_name: propertyName,
    guest_name: guestName,
    // 'guest' -> inbound, 'host' (a prior concierge reply) -> outbound. Mirrors
    // how a real thread labels Guest/Host lines in the prompt transcript.
    direction: m.role === 'guest' ? 'inbound' : 'outbound',
    body: m.text,
    sent_at: null,
    created_at: nowIso,
  }));

  const conversation: ConversationRow = {
    id: 'concierge-test',
    source: 'test',
    external_conversation_id: 'concierge-test',
    guest_name: guestName,
    property_id: input.propertyId,
    property_name: propertyName,
    channel: null,
    reservation_id: null,
    booking_state: bookingState,
    reservation_status: input.scenario === 'inquiry' ? 'inquiry' : 'current',
    check_in: stay.check_in,
    check_out: stay.check_out,
    last_message_at: nowIso,
    last_direction: messages[messages.length - 1].direction,
    last_message_preview: messages[messages.length - 1].body,
    message_count: messages.length,
    app_status: 'active',
    unread: false,
    archived: false,
    proposed_reply: null,
    proposed_reply_answers_message_id: null,
    proposed_reply_source: null,
    proposed_reply_generated_at: null,
  };

  const ctx: ConversationContext = {
    conversation,
    messages,
    reservation: null,
    stay,
  };

  // Pass the property-local date so "currently checked in" etc. resolve the same
  // way the model would experience for a real guest at this property right now.
  const { draft } = await generateGuestReplyDraftFromContext(ctx, { today });
  return { reply: draft };
}
