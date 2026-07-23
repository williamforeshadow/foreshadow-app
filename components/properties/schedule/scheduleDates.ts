import { parseISO } from 'date-fns';

// Parallelogram slant (px) applied to reservation/turnover bars so two bookings
// sharing a same-day turnover interlock like a handover. This is the SINGLE
// source of truth — every bar renderer (property Schedule MonthGrid, Timeline,
// TimelineWindow) imports it so the slant stays in lockstep across surfaces and
// week/month views. Tune here, not in the individual components.
export const RESERVATION_BAR_DIAGONAL_PX = 8;

// Reservation dates come as YYYY-MM-DD strings or ISO timestamps. We always
// want the local-day, so slice + parse explicitly to dodge timezone shifts.
export function toDateOnly(raw: string): Date {
  const justDate = raw.length >= 10 ? raw.slice(0, 10) : raw;
  return parseISO(`${justDate}T00:00:00`);
}

// Minimal shape the turnover-window filter needs from a task.
export interface WindowTaskInput {
  scheduled_date: string | null;
  scheduled_time: string | null;
}

/**
 * Filter tasks to those whose scheduled moment falls inside a reservation's
 * turnover window: `[check_in @ checkInTime, next_check_in @ checkInTime)`.
 *
 * Half-open — a task exactly at the next guest's check-in belongs to the NEXT
 * reservation, not this one. Open-ended when `nextCheckIn` is null (no next
 * booking). Comparisons are wall-clock 'YYYY-MM-DDTHH:MM' string lex compares
 * (never instantiating Date objects), so they stay timezone-agnostic — matching
 * the rest of the app and the `get_property_turnovers` SQL RPC that computes the
 * identical window server-side. Missing `scheduled_time` falls back to '00:00'
 * (earliest moment of the day). Result is sorted by (date, time).
 *
 * `checkIn`/`nextCheckIn` may be ISO timestamps or bare dates — only the date
 * portion is used. Returns [] when there's no check-in date to window against.
 */
export function filterTasksInTurnoverWindow<T extends WindowTaskInput>(
  tasks: T[],
  opts: { checkIn: string | null; nextCheckIn: string | null; checkInTime: string },
): T[] {
  const ci = opts.checkIn ? opts.checkIn.slice(0, 10) : '';
  if (!ci) return [];
  const time = opts.checkInTime.slice(0, 5) || '00:00';
  const startKey = `${ci}T${time}`;
  const nci = opts.nextCheckIn ? opts.nextCheckIn.slice(0, 10) : '';
  const endKey = nci ? `${nci}T${time}` : null;

  return tasks
    .filter((t) => {
      if (!t.scheduled_date) return false;
      const d = t.scheduled_date.slice(0, 10);
      const tt = (t.scheduled_time || '').slice(0, 5) || '00:00';
      const key = `${d}T${tt}`;
      if (key < startKey) return false;
      if (endKey && key >= endKey) return false;
      return true;
    })
    .sort((a, b) => {
      const ad = (a.scheduled_date || '').localeCompare(b.scheduled_date || '');
      if (ad !== 0) return ad;
      return (a.scheduled_time || '').localeCompare(b.scheduled_time || '');
    });
}
