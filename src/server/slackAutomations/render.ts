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

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

export interface ReservationVariables {
  property_name: string;
  guest_name: string;
  check_in: string;
  check_out: string;
  nights: string;
  trigger_date: string;
}

/**
 * Compute reservation-derived variables. Wall-clock dates are passed
 * through unchanged (they're already formatted YYYY-MM-DD by upstream).
 * `nights` is the simple day-difference between check_in and check_out.
 */
export function buildReservationVariables(args: {
  property_name: string | null;
  guest_name: string | null;
  check_in: string | null;
  check_out: string | null;
  trigger_date: string;
}): ReservationVariables {
  const checkIn = args.check_in ?? '';
  const checkOut = args.check_out ?? '';

  let nights = '';
  if (checkIn && checkOut) {
    const ms = new Date(checkOut).getTime() - new Date(checkIn).getTime();
    if (Number.isFinite(ms)) {
      const n = Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)));
      nights = String(n);
    }
  }

  return {
    property_name: args.property_name ?? '',
    guest_name: args.guest_name ?? '',
    check_in: checkIn,
    check_out: checkOut,
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
