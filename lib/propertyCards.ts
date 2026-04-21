// Shared definitions + validators for property_cards. Lives here so the
// API routes and the UI can both import a single source of truth for
// card categories and their sub-field schemas.

export type CardScope = 'interior' | 'exterior';

export type CardCategory =
  | 'appliance'
  | 'amenity'
  | 'safety'
  | 'quirk'
  | 'utility'
  | 'access'
  | 'other';

export const CARD_SCOPES: ReadonlySet<CardScope> = new Set<CardScope>([
  'interior',
  'exterior',
]);

export const CARD_CATEGORIES: ReadonlySet<CardCategory> = new Set<CardCategory>(
  ['appliance', 'amenity', 'safety', 'quirk', 'utility', 'access', 'other']
);

// Per-category structured sub-field schemas. Keys not in the schema for a
// category are dropped on write so the row stays clean for agent queries.
// Keys here double as allowed keys for category_data.
export interface CategorySubFieldSpec {
  key: string;
  label: string;
  kind: 'text' | 'date' | 'url' | 'enum';
  options?: string[]; // when kind === 'enum'
  placeholder?: string;
  multiline?: boolean;
}

export const CATEGORY_SUB_FIELDS: Record<CardCategory, CategorySubFieldSpec[]> = {
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
  // Categories with no sub-fields still appear in the record for exhaustive
  // typing so callers don't need to branch.
  quirk: [],
  access: [],
  other: [],
};

export const CATEGORY_LABELS: Record<CardCategory, string> = {
  appliance: 'Appliance',
  amenity: 'Amenity',
  safety: 'Safety',
  quirk: 'Quirk',
  utility: 'Utility',
  access: 'Access',
  other: 'Other',
};

// Default group labels surfaced in the UI even when no cards exist yet.
export const DEFAULT_INTERIOR_GROUPS = [
  'Bedrooms',
  'Bathrooms',
  'Kitchen',
  'Living Areas',
  'Other Rooms',
];
export const DEFAULT_EXTERIOR_GROUPS = [
  'Utilities',
  'HVAC',
  'Trash & Recycling',
  'Mail & Packages',
  'Outdoor Features',
];

// Normalize a client-supplied category_data blob to only the keys allowed
// for `category`. Returns a clean object safe to persist to the DB.
//
// Philosophy: silently drop unknown keys rather than 400, so the API stays
// forgiving when the UI evolves faster than server validation. Empty
// strings are coerced to null to keep JSON lean and agent queries sane.
export function normalizeCategoryData(
  category: CardCategory,
  raw: unknown
): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const spec = CATEGORY_SUB_FIELDS[category];
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
