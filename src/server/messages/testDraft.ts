import { getSupabaseServer } from '@/lib/supabaseServer';
import { todayInTz } from '@/src/lib/dates';
import { generateGuestReplyDraftFromContext } from './draftReply';
import { generateProposedTaskDraftFromContext } from './draftTask';
import { opsDefaultTimezone } from './opsToday';
import {
  generateProposedKnowledgeFromContext,
  type KnowledgeTarget,
} from './draftKnowledge';
import {
  loadConciergeProposalFlags,
  loadReplyProposalSensitivity,
} from './conciergeCapabilities';
import type { ConversationContext, StayWindow } from './conversationContext';
import type { ConversationRow, BookingState, CanonicalChannel } from '@/lib/conversations';
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
  /**
   * The OTA the simulated guest is messaging on. Drives channel-aware tools —
   * find_available_properties only recommends (and links) properties listed on
   * this channel. Null = unknown (real default for some sources); alternatives
   * can't be linked then, matching production.
   */
  channel?: CanonicalChannel | null;
}

/** A dummy proposed task, shaped to match the inbox's ProposedTaskData. */
export interface TestProposedTask {
  id: string;
  title: string;
  description: string | null;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  department_id: string | null;
  department_name: string | null;
  suggested_assignee_ids: string[];
  scheduled_date: string | null;
  scheduled_time: string | null;
}

/** A dummy proposed-knowledge addition, shaped to match ProposedKnowledgeData. */
export interface TestProposedKnowledge {
  id: string;
  summary: string;
  guest_visible: boolean;
  target: KnowledgeTarget | null;
}

export interface RunConciergeTestResult {
  /** The drafted reply, or '' when none was warranted / replies are disabled. */
  reply: string;
  /** Whether a reply was actually drafted (false when gated out or disabled). */
  warranted: boolean;
  /** Master switch state for autonomous replies — distinguishes "off" from "below threshold". */
  replyEnabled: boolean;
  /** Dummy proposed tasks for this turn (never persisted). */
  tasks: TestProposedTask[];
  /** Dummy proposed-knowledge additions for this turn (never persisted). */
  knowledge: TestProposedKnowledge[];
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

/** Resolve department id → name for proposed-task cards (best-effort, empty on error). */
async function loadDepartmentNames(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const { data } = await getSupabaseServer().from('departments').select('id, name');
    for (const d of (data ?? []) as Array<{ id: string; name: string | null }>) {
      if (d.name) map.set(d.id, d.name);
    }
  } catch {
    // Best-effort — a missing name just renders the card without a department label.
  }
  return map;
}

/**
 * Construct a synthetic ConversationContext for the chosen property + scenario,
 * then run the concierge's three capabilities against it EXACTLY as production
 * would: the reply path (gated by the master switch + reply sensitivity), task
 * triage (gated by the task switch + its sensitivity), and knowledge triage
 * (gated by the knowledge switch, and — like production — only once the thread
 * has a host message). Tasks and knowledge are returned as dummy proposals: the
 * real generation runs, but nothing is persisted and no notifications fire.
 */
export async function runConciergeTest(
  input: RunConciergeTestInput,
): Promise<RunConciergeTestResult> {
  const guestName = input.guestName.trim() || 'the guest';
  const cleaned = input.messages
    .map((m) => ({ role: m.role, text: (m.text ?? '').trim() }))
    .filter((m) => m.text.length > 0);

  if (cleaned.length === 0) {
    throw new Error('Type a guest message to test a reply.');
  }

  const { name: propertyName, timezone } = await getPropertyMeta(input.propertyId);
  // Property timezone first, then the org default, then UTC (todayInTz handles the
  // undefined → UTC fallback). Matches the real task path's resolution.
  const today = todayInTz(timezone ?? (await opsDefaultTimezone())).date;
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
    channel: input.channel ?? null,
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

  // Mirror production gating: the same master switches + sensitivity dials that
  // govern the autonomous webhook path govern the test, so the operator sees
  // exactly what the concierge would do with the current configuration.
  const flags = await loadConciergeProposalFlags();
  // Knowledge, like the webhook path, only triages once the thread has a host
  // (concierge) message — i.e. after at least one reply has been drafted.
  const hasHostMessage = cleaned.some((m) => m.role === 'host');

  // Run the three capabilities concurrently — they're independent. Task and
  // knowledge are best-effort (a failure there must not sink the whole test);
  // the reply is primary and allowed to throw up to the route.
  const [replyResult, tasks, knowledge] = await Promise.all([
    // Reply — gated by the master switch, then by the reply-sensitivity ladder.
    (async (): Promise<{ reply: string; warranted: boolean }> => {
      if (!flags.reply) return { reply: '', warranted: false };
      // Pass the property-local date so "currently checked in" etc. resolve the
      // same way the model would for a real guest at this property right now.
      const replySensitivity = await loadReplyProposalSensitivity();
      const { draft, warranted } = await generateGuestReplyDraftFromContext(ctx, {
        today,
        replySensitivity,
      });
      return { reply: draft, warranted };
    })(),
    // Tasks — gated by the master switch; the generator applies task sensitivity.
    (async (): Promise<TestProposedTask[]> => {
      if (!flags.task) return [];
      try {
        const [result, deptNames] = await Promise.all([
          generateProposedTaskDraftFromContext(ctx, { today }),
          loadDepartmentNames(),
        ]);
        return result.tasks.map((t, i) => ({
          id: `test-task-${i}`,
          title: t.title,
          description: t.description,
          priority: t.priority,
          department_id: t.department_id,
          department_name: t.department_id ? deptNames.get(t.department_id) ?? null : null,
          suggested_assignee_ids: t.suggested_assignee_ids,
          scheduled_date: t.scheduled_date,
          scheduled_time: t.scheduled_time,
        }));
      } catch (err) {
        console.error('[concierge test] task triage failed:', err);
        return [];
      }
    })(),
    // Knowledge — gated by the master switch + the host-message requirement.
    (async (): Promise<TestProposedKnowledge[]> => {
      if (!flags.knowledge || !hasHostMessage) return [];
      try {
        const result = await generateProposedKnowledgeFromContext(ctx);
        return result.proposals.map((p, i) => ({
          id: `test-knowledge-${i}`,
          summary: p.summary,
          guest_visible: p.guest_visible,
          target: p.target,
        }));
      } catch (err) {
        console.error('[concierge test] knowledge triage failed:', err);
        return [];
      }
    })(),
  ]);

  return {
    reply: replyResult.reply,
    warranted: replyResult.warranted,
    replyEnabled: flags.reply,
    tasks,
    knowledge,
  };
}
