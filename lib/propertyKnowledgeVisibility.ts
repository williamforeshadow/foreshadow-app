// Shared vocabulary for property-knowledge guest visibility (the lock/unlock
// allowlist). Used by the visibility API, the get_property_knowledge_for_guest
// tool, and the Knowledge-tab toggle UI so the resource_type / resource_id
// strings stay consistent in one place.

export const VISIBILITY_RESOURCE_TYPES = [
  'access_field',
  'connectivity_field',
  'note',
  'card',
  'room',
  'contact',
  'document',
  'tech_account',
] as const;

export type VisibilityResourceType = (typeof VISIBILITY_RESOURCE_TYPES)[number];

export function isVisibilityResourceType(v: unknown): v is VisibilityResourceType {
  return typeof v === 'string' && (VISIBILITY_RESOURCE_TYPES as readonly string[]).includes(v);
}

// The lockable fields of the two singleton "field-bag" tables. resource_id for
// an access_field / connectivity_field is one of these column names.
export const LOCKABLE_ACCESS_FIELDS = [
  'guest_code',
  'cleaner_code',
  'backup_code',
  'code_rotation_notes',
  'outer_door_code',
  'gate_code',
  'elevator_notes',
  'unit_door_code',
  'key_location',
  'lockbox_code',
  'parking_spot_number',
  'parking_type',
  'parking_instructions',
] as const;

export const LOCKABLE_CONNECTIVITY_FIELDS = [
  'wifi_ssid',
  'wifi_password',
  'wifi_router_location',
] as const;

/** A unique key for an unlocked item, used to build a Set on the client/tool. */
export function visibilityKey(resourceType: VisibilityResourceType, resourceId: string): string {
  return `${resourceType}:${resourceId}`;
}

export interface VisibilityRow {
  resource_type: VisibilityResourceType;
  resource_id: string;
}
