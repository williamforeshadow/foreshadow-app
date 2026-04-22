// Shared definitions + validators for property_rooms and property_cards.
// Lives here so API routes and the UI can both import a single source of
// truth for scopes, room types, tags, and their sub-field schemas.

export type CardScope = 'interior' | 'exterior';

export const CARD_SCOPES: ReadonlySet<CardScope> = new Set<CardScope>([
  'interior',
  'exterior',
]);

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

export type RoomType =
  // Interior-ish
  | 'bedroom'
  | 'bathroom'
  | 'kitchen'
  | 'living_room'
  | 'dining_room'
  | 'office'
  | 'hallway'
  | 'closet'
  | 'laundry'
  | 'basement'
  | 'attic'
  // Exterior-ish
  | 'garage'
  | 'driveway'
  | 'backyard'
  | 'front_yard'
  | 'patio'
  | 'deck'
  | 'pool_area'
  | 'roof'
  | 'shed'
  | 'parking_area'
  | 'outdoor'
  // Universal
  | 'other';

// Types shown in the Interior tab's type dropdown.
export const INTERIOR_ROOM_TYPES: RoomType[] = [
  'bedroom',
  'bathroom',
  'kitchen',
  'living_room',
  'dining_room',
  'office',
  'hallway',
  'closet',
  'laundry',
  'basement',
  'attic',
  'other',
];

// Types shown in the Exterior tab's type dropdown.
export const EXTERIOR_ROOM_TYPES: RoomType[] = [
  'garage',
  'driveway',
  'backyard',
  'front_yard',
  'patio',
  'deck',
  'pool_area',
  'roof',
  'shed',
  'parking_area',
  'outdoor',
  'other',
];

// Full enum list — used only for API validation. The DB enum accepts any
// of these regardless of scope; scope partitioning is a UI concern so
// that a rogue client can't lie about validation.
export const ROOM_TYPES: RoomType[] = Array.from(
  new Set<RoomType>([...INTERIOR_ROOM_TYPES, ...EXTERIOR_ROOM_TYPES])
);

export const ROOM_TYPE_LABELS: Record<RoomType, string> = {
  bedroom: 'Bedroom',
  bathroom: 'Bathroom',
  kitchen: 'Kitchen',
  living_room: 'Living room',
  dining_room: 'Dining room',
  office: 'Office',
  hallway: 'Hallway',
  closet: 'Closet',
  laundry: 'Laundry',
  basement: 'Basement',
  attic: 'Attic',
  garage: 'Garage',
  driveway: 'Driveway',
  backyard: 'Backyard',
  front_yard: 'Front yard',
  patio: 'Patio',
  deck: 'Deck',
  pool_area: 'Pool area',
  roof: 'Roof',
  shed: 'Shed',
  parking_area: 'Parking area',
  outdoor: 'Outdoor',
  other: 'Other',
};

export function defaultRoomTitle(type: RoomType): string {
  return ROOM_TYPE_LABELS[type];
}

// ---------------------------------------------------------------------------
// Card tags (previously "category")
// ---------------------------------------------------------------------------

export type CardTag =
  | 'appliance'
  | 'amenity'
  | 'safety'
  | 'quirk'
  | 'utility'
  | 'access'
  | 'other';

export const CARD_TAGS: CardTag[] = [
  'appliance',
  'amenity',
  'safety',
  'quirk',
  'utility',
  'access',
  'other',
];

export const CARD_TAG_SET: ReadonlySet<CardTag> = new Set<CardTag>(CARD_TAGS);

export const TAG_LABELS: Record<CardTag, string> = {
  appliance: 'Appliance',
  amenity: 'Amenity',
  safety: 'Safety',
  quirk: 'Quirk',
  utility: 'Utility',
  access: 'Access',
  other: 'Other',
};

// Pill colors for the inline tag chip. Light and dark variants so the chip
// stays legible on both themes. Neutral for 'other' so the default doesn't
// scream for attention.
export const TAG_CHIP_CLASSES: Record<CardTag, string> = {
  appliance:
    'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/30',
  amenity:
    'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30',
  safety:
    'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30',
  quirk:
    'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30',
  utility:
    'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30',
  access:
    'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-500/30',
  other:
    'bg-neutral-100 text-neutral-600 border-neutral-200 dark:bg-white/5 dark:text-[#a09e9a] dark:border-white/10',
};

// Per-tag structured sub-field schemas. Keys not in the schema for a tag
// are dropped on write so the row stays clean for agent queries.
export interface TagSubFieldSpec {
  key: string;
  label: string;
  kind: 'text' | 'date' | 'url' | 'enum';
  options?: string[]; // when kind === 'enum'
  placeholder?: string;
  multiline?: boolean;
}

export const TAG_SUB_FIELDS: Record<CardTag, TagSubFieldSpec[]> = {
  appliance: [
    { key: 'make', label: 'Make', kind: 'text', placeholder: 'e.g. Bosch' },
    { key: 'model', label: 'Model', kind: 'text', placeholder: 'e.g. SHPM88Z75N' },
    { key: 'warranty_expiration', label: 'Warranty expiration', kind: 'date' },
    { key: 'manual_url', label: 'Manual link', kind: 'url', placeholder: 'https://…' },
  ],
  safety: [
    {
      key: 'emergency_action',
      label: 'Emergency action',
      kind: 'text',
      multiline: true,
      placeholder: 'What to do in an emergency',
    },
    {
      key: 'severity',
      label: 'Severity',
      kind: 'enum',
      options: ['low', 'med', 'high'],
    },
  ],
  amenity: [
    {
      key: 'access_instructions',
      label: 'Access instructions',
      kind: 'text',
      multiline: true,
      placeholder: 'How to use / access it',
    },
    {
      key: 'restrictions',
      label: 'Restrictions',
      kind: 'text',
      multiline: true,
      placeholder: 'Quiet hours, caps, etc.',
    },
  ],
  utility: [
    {
      key: 'shutoff_location',
      label: 'Shutoff / control location',
      kind: 'text',
      placeholder: 'e.g. Basement closet, labeled panel',
    },
    {
      key: 'shutoff_instructions',
      label: 'Shutoff / control instructions',
      kind: 'text',
      multiline: true,
    },
  ],
  // Tags with no sub-fields still appear in the record for exhaustive
  // typing so callers don't need to branch.
  quirk: [],
  access: [],
  other: [],
};

// Normalize a client-supplied tag_data blob to only the keys allowed for
// `tag`. Returns a clean object safe to persist to the DB.
//
// Philosophy: silently drop unknown keys rather than 400, so the API stays
// forgiving when the UI evolves faster than server validation. Empty
// strings are coerced to null to keep JSON lean and agent queries sane.
export function normalizeTagData(
  tag: CardTag,
  raw: unknown
): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const spec = TAG_SUB_FIELDS[tag];
  const input = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const field of spec) {
    const v = input[field.key];
    if (v === undefined || v === null) continue;
    if (typeof v === 'string') {
      const trimmed = v.trim();
      if (trimmed === '') continue;
      if (field.kind === 'enum' && field.options && !field.options.includes(trimmed)) {
        continue;
      }
      out[field.key] = trimmed;
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      out[field.key] = v;
    }
  }
  return out;
}
