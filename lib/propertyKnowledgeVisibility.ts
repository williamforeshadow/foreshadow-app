// Shared vocabulary for property-knowledge guest visibility (the lock/unlock
// allowlist). Used by the visibility API, the get_property_knowledge_for_guest
// tool, and the Knowledge-tab toggle UI so the resource_type / resource_id
// strings stay consistent in one place.
//
// Model: visibility is PER-FIELD. The two singleton field-bags (access,
// connectivity) key by column name; every collection item keys by
// `${rowId}:${fieldName}`. Presence of a row in property_knowledge_visibility
// = that field is UNLOCKED (visible to the guest-facing Concierge). Everything
// is locked by default.

export const VISIBILITY_RESOURCE_TYPES = [
  'access_field',
  'connectivity_field',
  'room_field',
  'attribute_field',
  'contact_field',
  'document_field',
  'tech_account_field',
] as const;

export type VisibilityResourceType = (typeof VISIBILITY_RESOURCE_TYPES)[number];

export function isVisibilityResourceType(v: unknown): v is VisibilityResourceType {
  return typeof v === 'string' && (VISIBILITY_RESOURCE_TYPES as readonly string[]).includes(v);
}

// The lockable fields of the two singleton "field-bag" tables. resource_id for
// an access_field / connectivity_field is one of these column names directly.
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

// The lockable fields of each collection resource. `photos` / `file` are
// pseudo-fields that gate the nested binary arrays. resource_id for these is
// `${rowId}:${fieldName}`.
export const RESOURCE_FIELD_SETS: Record<VisibilityResourceType, readonly string[]> = {
  access_field: LOCKABLE_ACCESS_FIELDS,
  connectivity_field: LOCKABLE_CONNECTIVITY_FIELDS,
  room_field: ['title', 'notes', 'photos'],
  attribute_field: ['title', 'body', 'tags', 'photos'],
  contact_field: ['name', 'role', 'phone', 'email', 'schedule', 'preferences', 'notes'],
  document_field: ['title', 'notes', 'file'],
  tech_account_field: ['service_name', 'username', 'password', 'notes', 'photos'],
};

/** True when `field` is a valid lockable field for the resource type. */
export function isLockableField(type: VisibilityResourceType, field: string): boolean {
  return (RESOURCE_FIELD_SETS[type] as readonly string[]).includes(field);
}

// resource_id encoding for the collection (non-singleton) field types: a row id
// and a field name joined by ':'. Row ids are UUIDs (no ':'), so the first ':'
// is an unambiguous split point.
export function encodeFieldResourceId(rowId: string, field: string): string {
  return `${rowId}:${field}`;
}

export function decodeFieldResourceId(resourceId: string): { rowId: string; field: string } {
  const i = resourceId.indexOf(':');
  if (i === -1) return { rowId: resourceId, field: '' };
  return { rowId: resourceId.slice(0, i), field: resourceId.slice(i + 1) };
}

/** True for the two singleton field-bags whose resource_id is a bare column name. */
export function isSingletonFieldType(type: VisibilityResourceType): boolean {
  return type === 'access_field' || type === 'connectivity_field';
}

/** A unique key for an unlocked item, used to build a Set on the client/tool. */
export function visibilityKey(resourceType: VisibilityResourceType, resourceId: string): string {
  return `${resourceType}:${resourceId}`;
}

export interface VisibilityRow {
  resource_type: VisibilityResourceType;
  resource_id: string;
}
