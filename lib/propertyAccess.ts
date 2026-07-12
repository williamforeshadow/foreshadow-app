// Shared definitions for property_access_items — the curated access-item types,
// their default labels + picker grouping, and validators. Single source of truth
// for the Access UI, the write service, the guest-visibility model, and the agent
// tool. Replaces the old fixed `ACCESS_FIELDS` / `LOCKABLE_ACCESS_FIELDS` column
// lists (Access is now a configurable collection, not a 13-column singleton).

export type AccessValueKind = 'text' | 'parking_type';

export interface AccessTypeDef {
  key: string;
  /** Default display label (editable in the UI; required to supply for `other`). */
  label: string;
  /** Picker grouping. */
  group: string;
  /** How the value is entered: a free-text code, or the parking-type dropdown. */
  valueKind: AccessValueKind;
}

export const PARKING_TYPES = ['assigned', 'street', 'garage', 'other'] as const;
export type ParkingType = (typeof PARKING_TYPES)[number];

// The curated types. Order here drives the picker order within each group.
export const ACCESS_TYPES: AccessTypeDef[] = [
  // Entry
  { key: 'entry_code', label: 'Entry code (guest)', group: 'Entry', valueKind: 'text' },
  { key: 'backup_code', label: 'Backup code', group: 'Entry', valueKind: 'text' },
  { key: 'team_code', label: 'Team / cleaner code', group: 'Entry', valueKind: 'text' },
  { key: 'owner_code', label: 'Owner code', group: 'Entry', valueKind: 'text' },
  // Building & common
  { key: 'building_code', label: 'Building / exterior door code', group: 'Building & common', valueKind: 'text' },
  { key: 'lobby_code', label: 'Lobby code', group: 'Building & common', valueKind: 'text' },
  { key: 'gate_code', label: 'Gate code', group: 'Building & common', valueKind: 'text' },
  { key: 'elevator', label: 'Elevator', group: 'Building & common', valueKind: 'text' },
  { key: 'parking_garage_code', label: 'Parking garage code', group: 'Building & common', valueKind: 'text' },
  { key: 'mailbox_code', label: 'Mailbox / package room code', group: 'Building & common', valueKind: 'text' },
  { key: 'amenity_code', label: 'Amenity code (pool/gym)', group: 'Building & common', valueKind: 'text' },
  { key: 'intercom_code', label: 'Intercom / buzzer code', group: 'Building & common', valueKind: 'text' },
  { key: 'storage_code', label: 'Storage / locker code', group: 'Building & common', valueKind: 'text' },
  // Keys & devices
  { key: 'lockbox_code', label: 'Lockbox code', group: 'Keys & devices', valueKind: 'text' },
  { key: 'lockbox_location', label: 'Lockbox location', group: 'Keys & devices', valueKind: 'text' },
  { key: 'key_location', label: 'Key location', group: 'Keys & devices', valueKind: 'text' },
  { key: 'fob_keycard', label: 'Fob / key card', group: 'Keys & devices', valueKind: 'text' },
  { key: 'alarm_code', label: 'Alarm / security code', group: 'Keys & devices', valueKind: 'text' },
  // Parking
  { key: 'parking_spot', label: 'Parking spot number', group: 'Parking', valueKind: 'text' },
  { key: 'parking_type', label: 'Parking type', group: 'Parking', valueKind: 'parking_type' },
  { key: 'parking_location', label: 'Parking location / instructions', group: 'Parking', valueKind: 'text' },
  { key: 'guest_parking_pass', label: 'Guest parking pass', group: 'Parking', valueKind: 'text' },
  { key: 'ev_charger', label: 'EV charger access', group: 'Parking', valueKind: 'text' },
  // Custom
  { key: 'other', label: 'Other', group: 'Other', valueKind: 'text' },
];

export const ACCESS_TYPE_KEYS: string[] = ACCESS_TYPES.map((t) => t.key);

const ACCESS_TYPE_BY_KEY: Record<string, AccessTypeDef> = Object.fromEntries(
  ACCESS_TYPES.map((t) => [t.key, t]),
);

export function accessTypeDef(key: string): AccessTypeDef | undefined {
  return ACCESS_TYPE_BY_KEY[key];
}

/** Coerce a client/model-supplied type to a known key; unknown → 'other'. */
export function normalizeAccessType(raw: unknown): string {
  return typeof raw === 'string' && ACCESS_TYPE_BY_KEY[raw] ? raw : 'other';
}

/** Default label for a curated type; '' for `other` (the caller must supply one). */
export function defaultAccessLabel(typeKey: string): string {
  const def = ACCESS_TYPE_BY_KEY[typeKey];
  return def && def.key !== 'other' ? def.label : '';
}

/** How a given type's value is entered. */
export function accessValueKind(typeKey: string): AccessValueKind {
  return ACCESS_TYPE_BY_KEY[typeKey]?.valueKind ?? 'text';
}

export function isParkingType(v: unknown): v is ParkingType {
  return typeof v === 'string' && (PARKING_TYPES as readonly string[]).includes(v);
}

// Per-item guest-visibility fields (collection model): value + notes travel together.
export const ACCESS_ITEM_FIELDS = ['value', 'notes'] as const;

// Grouped view for the "Add access item" picker.
export const ACCESS_TYPE_GROUPS: { title: string; types: AccessTypeDef[] }[] = [
  'Entry',
  'Building & common',
  'Keys & devices',
  'Parking',
  'Other',
].map((title) => ({ title, types: ACCESS_TYPES.filter((t) => t.group === title) }));
