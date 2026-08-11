import type { Task, Turnover } from './types';

export type PropertyReadiness =
  | {
      /** 'ready' when at least one gating task exists and all are complete. */
      state: 'ready' | 'attention';
      /** The gating tasks (informs_readiness templates) inside the vacancy window. */
      tasks: Task[];
      completed: number;
      total: number;
      /** The checked-out reservation whose vacancy window governs the state. */
      reservation: Turnover;
    }
  | {
      /** A stay is in progress — readiness doesn't apply mid-stay. */
      state: 'occupied';
      /** The in-house reservation (guest booking or owner stay). */
      reservation: Turnover;
    };

/**
 * Derive the Schedule's property-readiness state from a property's
 * reservation list (the get_property_turnovers rows, which carry each
 * reservation's windowed task jsonb).
 *
 * Readiness only exists during a vacancy: while a guest (or owner — treated
 * identically) is in the property the state is 'occupied' (informational
 * icon, no ready/attention judgment), and before any checkout has ever
 * happened there is nothing to be ready for, so this returns null and no
 * icon renders. During a vacancy, the gating set is the tasks whose template
 * has informs_readiness on, scheduled between the governing check-out and
 * the next check-in (unbounded when there is no next booking). Zero gating
 * tasks after a checkout is itself an attention state — the property has no
 * configured evidence it was turned over.
 */
export function getPropertyReadiness(reservations: Turnover[]): PropertyReadiness | null {
  // Calendar blocks are merged into the timeline's reservation list
  // client-side but aren't reservations (no tasks, no checkout semantics).
  const real = reservations.filter((r) => r.kind !== 'block' && r.check_out);
  if (!real.length) return null;

  const now = new Date();

  // Occupied: ready-or-not doesn't matter mid-stay.
  const occupying = real.find((r) => {
    const checkIn = r.check_in ? new Date(r.check_in) : null;
    const checkOut = new Date(r.check_out!);
    return checkIn !== null && now >= checkIn && now < checkOut;
  });
  if (occupying) return { state: 'occupied', reservation: occupying };

  // Governing vacancy: the latest checkout already in the past. (When its
  // next_check_in has also passed, that next reservation is itself either
  // occupied — handled above — or checked out, in which case it is the later
  // checkout and wins this reduce anyway.)
  let governing: Turnover | null = null;
  for (const r of real) {
    const checkOut = new Date(r.check_out!);
    if (checkOut > now) continue;
    if (!governing || checkOut > new Date(governing.check_out!)) governing = r;
  }
  if (!governing) return null;

  const checkOut = new Date(governing.check_out!);
  const nextCheckIn = governing.next_check_in ? new Date(governing.next_check_in) : null;

  // Lower bound is day-granular so an untimed checkout-day clean (which
  // parses as 00:00) isn't dropped by the checkout's time of day.
  const checkOutDayStart = new Date(checkOut.getFullYear(), checkOut.getMonth(), checkOut.getDate());

  const gating = (governing.tasks || []).filter((task) => {
    if (!task.informs_readiness || task.status === 'contingent') return false;
    if (!task.scheduled_date) return false;
    const scheduled = new Date(`${task.scheduled_date}T${task.scheduled_time || '00:00'}`);
    if (Number.isNaN(scheduled.getTime())) return false;
    if (scheduled < checkOutDayStart) return false;
    if (nextCheckIn && scheduled >= nextCheckIn) return false;
    return true;
  });

  const completed = gating.filter((t) => t.status === 'complete').length;

  return {
    state: gating.length > 0 && completed === gating.length ? 'ready' : 'attention',
    tasks: gating,
    completed,
    total: gating.length,
    reservation: governing,
  };
}
