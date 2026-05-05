// Curated list of common IANA timezones for the timezone picker UI.
//
// Grouped by region with human-readable labels. Covers the US thoroughly
// (where most clients operate) plus major international zones for teams
// with remote members. The IANA value is what gets persisted; the label
// is display-only.

export interface TimezoneOption {
  value: string; // IANA timezone identifier
  label: string; // Human-readable label
  group: string; // Region grouping for optgroup
}

export const TIMEZONE_OPTIONS: TimezoneOption[] = [
  // ── United States ─────────────────────────────────────────────────
  { value: 'Pacific/Honolulu', label: 'Hawaii (HST)', group: 'United States' },
  { value: 'America/Anchorage', label: 'Alaska (AKST)', group: 'United States' },
  { value: 'America/Los_Angeles', label: 'Pacific (PST)', group: 'United States' },
  { value: 'America/Denver', label: 'Mountain (MST)', group: 'United States' },
  { value: 'America/Phoenix', label: 'Arizona (no DST)', group: 'United States' },
  { value: 'America/Chicago', label: 'Central (CST)', group: 'United States' },
  { value: 'America/New_York', label: 'Eastern (EST)', group: 'United States' },

  // ── Americas ──────────────────────────────────────────────────────
  { value: 'America/Vancouver', label: 'Vancouver (PST)', group: 'Americas' },
  { value: 'America/Toronto', label: 'Toronto (EST)', group: 'Americas' },
  { value: 'America/Mexico_City', label: 'Mexico City (CST)', group: 'Americas' },
  { value: 'America/Bogota', label: 'Bogotá (COT)', group: 'Americas' },
  { value: 'America/Sao_Paulo', label: 'São Paulo (BRT)', group: 'Americas' },
  { value: 'America/Argentina/Buenos_Aires', label: 'Buenos Aires (ART)', group: 'Americas' },

  // ── Europe ────────────────────────────────────────────────────────
  { value: 'Europe/London', label: 'London (GMT)', group: 'Europe' },
  { value: 'Europe/Paris', label: 'Paris (CET)', group: 'Europe' },
  { value: 'Europe/Berlin', label: 'Berlin (CET)', group: 'Europe' },
  { value: 'Europe/Madrid', label: 'Madrid (CET)', group: 'Europe' },
  { value: 'Europe/Rome', label: 'Rome (CET)', group: 'Europe' },
  { value: 'Europe/Istanbul', label: 'Istanbul (TRT)', group: 'Europe' },

  // ── Asia & Pacific ────────────────────────────────────────────────
  { value: 'Asia/Dubai', label: 'Dubai (GST)', group: 'Asia & Pacific' },
  { value: 'Asia/Kolkata', label: 'India (IST)', group: 'Asia & Pacific' },
  { value: 'Asia/Bangkok', label: 'Bangkok (ICT)', group: 'Asia & Pacific' },
  { value: 'Asia/Singapore', label: 'Singapore (SGT)', group: 'Asia & Pacific' },
  { value: 'Asia/Manila', label: 'Manila (PHT)', group: 'Asia & Pacific' },
  { value: 'Asia/Shanghai', label: 'Shanghai (CST)', group: 'Asia & Pacific' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)', group: 'Asia & Pacific' },
  { value: 'Asia/Seoul', label: 'Seoul (KST)', group: 'Asia & Pacific' },
  { value: 'Australia/Sydney', label: 'Sydney (AEST)', group: 'Asia & Pacific' },
  { value: 'Pacific/Auckland', label: 'Auckland (NZST)', group: 'Asia & Pacific' },

  // ── Other ─────────────────────────────────────────────────────────
  { value: 'UTC', label: 'UTC', group: 'Other' },
];

// Group names in display order.
export const TIMEZONE_GROUPS = [
  'United States',
  'Americas',
  'Europe',
  'Asia & Pacific',
  'Other',
] as const;
