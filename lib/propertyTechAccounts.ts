// Shared definitions + validators for property_tech_accounts.
// Imported by API routes and the Connectivity UI so there's a single
// source of truth for kinds, labels, chip colors, and quick-add presets.

export type TechAccountKind =
  | 'streaming'
  | 'music'
  | 'smart_home'
  | 'tv_cable'
  | 'isp'
  | 'security'
  | 'thermostat'
  | 'other';

export const TECH_ACCOUNT_KINDS: TechAccountKind[] = [
  'streaming',
  'music',
  'smart_home',
  'tv_cable',
  'isp',
  'security',
  'thermostat',
  'other',
];

export const KIND_LABELS: Record<TechAccountKind, string> = {
  streaming: 'Streaming',
  music: 'Music',
  smart_home: 'Smart home',
  tv_cable: 'TV / Cable',
  isp: 'Internet',
  security: 'Security',
  thermostat: 'Thermostat',
  other: 'Other',
};

// Pill colors for the inline kind chip — matches the visual system used
// by card tags (TAG_CHIP_CLASSES) so both surfaces feel cohesive.
export const KIND_CHIP_CLASSES: Record<TechAccountKind, string> = {
  streaming:
    'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30',
  music:
    'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30',
  smart_home:
    'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-500/30',
  tv_cable:
    'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/30',
  isp:
    'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30',
  security:
    'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30',
  thermostat:
    'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/30',
  other:
    'bg-neutral-100 text-neutral-600 border-neutral-200 dark:bg-white/5 dark:text-[#a09e9a] dark:border-white/10',
};

// Quick-add chips shown above the list. Clicking one creates a row with
// the preset kind + service_name already filled in; the user can edit
// both freely afterward. Order matters — render in array order.
export interface TechAccountPreset {
  kind: TechAccountKind;
  service_name: string;
}

export const TECH_ACCOUNT_PRESETS: TechAccountPreset[] = [
  { kind: 'streaming', service_name: 'Netflix' },
  { kind: 'streaming', service_name: 'Hulu' },
  { kind: 'streaming', service_name: 'Disney+' },
  { kind: 'streaming', service_name: 'Max' },
  { kind: 'streaming', service_name: 'Prime Video' },
  { kind: 'music', service_name: 'Spotify' },
  { kind: 'tv_cable', service_name: 'YouTube TV' },
  { kind: 'security', service_name: 'Ring' },
  { kind: 'thermostat', service_name: 'Nest Thermostat' },
  { kind: 'smart_home', service_name: 'Alexa' },
];

// Defaults for the plain "+ Add account" button.
export const DEFAULT_TECH_ACCOUNT_KIND: TechAccountKind = 'other';
export const DEFAULT_TECH_ACCOUNT_SERVICE_NAME = 'Account';
