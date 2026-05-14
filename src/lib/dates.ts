// Shared date utilities for timezone-aware date resolution.
//
// Wall-clock convention: Foreshadow stores dates and times as bare strings
// (YYYY-MM-DD, HH:MM) with no embedded timezone. Each property *may* have an
// IANA timezone that anchors those wall-clock values to a real-world location.
// These helpers resolve "today" (or any relative concept) into a concrete
// YYYY-MM-DD date in a given timezone.

/**
 * Resolve "today" in the given IANA timezone. Falls back to UTC when `tz` is
 * undefined, empty, or invalid. Uses 'en-CA' locale because it always formats
 * as YYYY-MM-DD — the shape every tool input and Postgres date column expects.
 */
export function todayInTz(tz: string | undefined): { date: string; tz: string } {
  if (tz) {
    try {
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(
        new Date(),
      );
      return { date, tz };
    } catch {
      // Invalid IANA string — fall through to UTC.
    }
  }
  return { date: new Date().toISOString().slice(0, 10), tz: 'UTC' };
}

/** Default org timezone used when operations_settings hasn't been configured. */
export const DEFAULT_TIMEZONE = 'America/Los_Angeles';

/**
 * Current hour (0–23) in the given IANA timezone. Used by the due-today cron
 * to match against each user's preferred firing hour.
 */
export function currentHourInTz(tz: string): number {
  try {
    return Number(
      new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        hour12: false,
        timeZone: tz,
      }).format(new Date()),
    );
  } catch {
    return new Date().getUTCHours();
  }
}

const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Compact, glanceable "time ago" label for UI surfaces like the notifications
 * bell. Buckets:
 *   < 1 min   → "just now"
 *   < 1 hour  → "Xm"
 *   < 1 day   → "Xh"
 *   < 7 days  → "Xd"
 *   ≥ 7 days  → "Mon D"  (drops the year — long enough ago that exact day matters
 *                         more than the year for in-bell scanning)
 */
export function formatRelative(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  const date = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const diffSec = Math.max(0, (Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
  if (diffSec < 7 * 86400) return `${Math.floor(diffSec / 86400)}d`;
  const month = MONTH_SHORT[date.getMonth()] ?? '';
  return `${month} ${date.getDate()}`;
}
