import { parseISO } from 'date-fns';

// Reservation dates come as YYYY-MM-DD strings or ISO timestamps. We always
// want the local-day, so slice + parse explicitly to dodge timezone shifts.
export function toDateOnly(raw: string): Date {
  const justDate = raw.length >= 10 ? raw.slice(0, 10) : raw;
  return parseISO(`${justDate}T00:00:00`);
}
