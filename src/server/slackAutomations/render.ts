// Template variable substitution for Slack automation messages.
//
// The user writes a message template with `{{variable}}` placeholders in the
// Slack Automations editor. This module renders those placeholders against
// the firing reservation.
//
// Design notes:
//   - Unknown / missing variables render as the empty string (not the
//     placeholder itself). The alternative — leaving `{{foo}}` in the
//     output — would push internal syntax to Slack users.
//   - Whitespace inside the braces is tolerated: `{{ guest_name }}` works.
//   - Variable names are alphanumeric + underscore. Anything else
//     (curly braces, code blocks, etc.) passes through untouched.
//
// Date/time formatting:
//   Hostaway only supplies dates (YYYY-MM-DD), not times. Operations
//   settings carries org-wide default check-in / check-out times that we
//   bolt on for variables like {{check_in_time}} and {{check_in_datetime}}.
//   This is operational expectation, not actual guest arrival — the variable
//   descriptions in the editor's picker make that explicit.

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

export interface ReservationVariables {
  property_name: string;
  guest_name: string;
  /** Pretty: e.g. "May 30, 2026". */
  check_in: string;
  /** Pretty: e.g. "May 30, 2026". */
  check_out: string;
  /** From operations_settings.default_check_in_time, formatted "3:00 PM". */
  check_in_time: string;
  /** From operations_settings.default_check_out_time, formatted "11:00 AM". */
  check_out_time: string;
  /** Combined: e.g. "May 30, 2026 at 3:00 PM". */
  check_in_datetime: string;
  /** Combined: e.g. "May 30, 2026 at 11:00 AM". */
  check_out_datetime: string;
  /** Raw YYYY-MM-DD escape hatch. */
  check_in_iso: string;
  /** Raw YYYY-MM-DD escape hatch. */
  check_out_iso: string;
  nights: string;
  /** Today, resolved in the property's timezone (or org default fallback). */
  trigger_date: string;
}

// Format a YYYY-MM-DD string as "May 30, 2026" without timezone shifting.
//
// We deliberately don't pass the date through Date constructor + Intl with
// timezone — that introduces UTC parsing bugs (a "2026-05-30" date created
// from `new Date('2026-05-30')` is interpreted as UTC midnight, then formatted
// in some other tz, which can shift the day. Reservations are wall-clock dates
// with no real timezone, so we parse the components manually and ask Intl to
// format a Date created from local components.
function formatPrettyDate(yyyymmdd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(yyyymmdd)) return yyyymmdd;
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

// Format an HH:MM (24-hour, wall-clock) string as "3:00 PM".
function formatPrettyTime(hhmm: string): string {
  if (!/^\d{2}:\d{2}/.test(hhmm)) return hhmm;
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  const date = new Date();
  date.setHours(h, m, 0, 0);
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

function combineDateTime(prettyDate: string, prettyTime: string): string {
  if (!prettyDate && !prettyTime) return '';
  if (!prettyTime) return prettyDate;
  if (!prettyDate) return prettyTime;
  return `${prettyDate} at ${prettyTime}`;
}

/**
 * Compute reservation-derived variables.
 *
 * `defaultCheckInTime` / `defaultCheckOutTime` come from operations_settings
 * and provide the time-of-day for {{check_in_time}} / {{check_in_datetime}}.
 * They're operational expectations, not actual guest arrival times.
 */
export function buildReservationVariables(args: {
  property_name: string | null;
  guest_name: string | null;
  check_in: string | null;
  check_out: string | null;
  trigger_date: string;
  default_check_in_time: string;
  default_check_out_time: string;
}): ReservationVariables {
  const checkInIso = args.check_in ?? '';
  const checkOutIso = args.check_out ?? '';
  const checkInPretty = checkInIso ? formatPrettyDate(checkInIso) : '';
  const checkOutPretty = checkOutIso ? formatPrettyDate(checkOutIso) : '';
  const checkInTimePretty = args.default_check_in_time
    ? formatPrettyTime(args.default_check_in_time)
    : '';
  const checkOutTimePretty = args.default_check_out_time
    ? formatPrettyTime(args.default_check_out_time)
    : '';

  let nights = '';
  if (checkInIso && checkOutIso) {
    const ms = new Date(checkOutIso).getTime() - new Date(checkInIso).getTime();
    if (Number.isFinite(ms)) {
      const n = Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)));
      nights = String(n);
    }
  }

  return {
    property_name: args.property_name ?? '',
    guest_name: args.guest_name ?? '',
    check_in: checkInPretty,
    check_out: checkOutPretty,
    check_in_time: checkInTimePretty,
    check_out_time: checkOutTimePretty,
    check_in_datetime: combineDateTime(checkInPretty, checkInTimePretty),
    check_out_datetime: combineDateTime(checkOutPretty, checkOutTimePretty),
    check_in_iso: checkInIso,
    check_out_iso: checkOutIso,
    nights,
    trigger_date: args.trigger_date,
  };
}

export function renderTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  if (!template) return '';
  return template.replace(PLACEHOLDER_RE, (_, name: string) => {
    const value = vars[name];
    return value === undefined || value === null ? '' : String(value);
  });
}
