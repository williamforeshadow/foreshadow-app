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
