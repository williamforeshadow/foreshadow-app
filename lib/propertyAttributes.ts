// Shared definitions + validators for property_rooms, property_attributes
// (formerly "cards"), and property_contacts tags. Single source of truth for
// scopes, attribute tags, contact tags, and their chip styling so API routes,
// agent tools, and the UI all agree.

// ---------------------------------------------------------------------------
// Scope (interior / exterior) — shared by rooms and the attributes under them.
// ---------------------------------------------------------------------------

export type AttributeScope = 'interior' | 'exterior';

export const ATTRIBUTE_SCOPES: ReadonlySet<AttributeScope> = new Set<AttributeScope>([
  'interior',
  'exterior',
]);

// ---------------------------------------------------------------------------
// Attribute tags (multi-select). Replaces the old single `tag` enum + the
// per-tag structured sub-fields. Tags describe durable facts about the house;
// defects/needs-repair items are operational work (tasks), not knowledge.
// ---------------------------------------------------------------------------

export type AttributeTag =
  | 'appliance'
  | 'amenity'
  | 'safety'
  | 'quirk'
  | 'utility'
  | 'access'
  | 'other';

export const ATTRIBUTE_TAGS: AttributeTag[] = [
  'appliance',
  'amenity',
  'safety',
  'quirk',
  'utility',
  'access',
  'other',
];

export const ATTRIBUTE_TAG_SET: ReadonlySet<AttributeTag> = new Set<AttributeTag>(ATTRIBUTE_TAGS);

export const TAG_LABELS: Record<AttributeTag, string> = {
  appliance: 'Appliance',
  amenity: 'Amenity',
  safety: 'Safety',
  quirk: 'Quirk',
  utility: 'Utility',
  access: 'Access',
  other: 'Other',
};

// Pill colors for the inline tag chip (light + dark).
export const TAG_CHIP_CLASSES: Record<AttributeTag, string> = {
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

/**
 * Coerce a client/model-supplied tags blob into a clean, deduped array of
 * valid AttributeTags. Unknown values are dropped (forgiving, like the old
 * normalizeTagData). An empty array is allowed — an attribute is identified
 * by its title, not a required tag.
 */
export function normalizeTags(raw: unknown): AttributeTag[] {
  if (!Array.isArray(raw)) return [];
  const out: AttributeTag[] = [];
  for (const v of raw) {
    if (typeof v === 'string' && ATTRIBUTE_TAG_SET.has(v as AttributeTag) && !out.includes(v as AttributeTag)) {
      out.push(v as AttributeTag);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Contact tags (multi-select) — replaces the old single `category` enum.
// `owners` unlocks the contact's Preferences field in the UI (the former
// owner-preferences notes live here now).
// ---------------------------------------------------------------------------

export type ContactTag =
  | 'cleaning'
  | 'maintenance'
  | 'contractors'
  | 'owners'
  | 'stakeholders'
  | 'emergency'
  | 'other';

export const CONTACT_TAGS: ContactTag[] = [
  'cleaning',
  'maintenance',
  'contractors',
  'owners',
  'stakeholders',
  'emergency',
  'other',
];

export const CONTACT_TAG_SET: ReadonlySet<ContactTag> = new Set<ContactTag>(CONTACT_TAGS);

export const CONTACT_TAG_LABELS: Record<ContactTag, string> = {
  cleaning: 'Cleaning',
  maintenance: 'Maintenance',
  contractors: 'Contractors',
  owners: 'Owners',
  stakeholders: 'Stakeholders',
  emergency: 'Emergency',
  other: 'Other',
};

export const CONTACT_TAG_CHIP_CLASSES: Record<ContactTag, string> = {
  cleaning:
    'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30',
  maintenance:
    'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30',
  contractors:
    'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30',
  owners:
    'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-500/30',
  stakeholders:
    'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/30',
  emergency:
    'bg-red-100 text-red-700 border-red-300 dark:bg-red-500/20 dark:text-red-300 dark:border-red-500/40',
  other:
    'bg-neutral-100 text-neutral-600 border-neutral-200 dark:bg-white/5 dark:text-[#a09e9a] dark:border-white/10',
};

/** Coerce a tags blob into a clean, deduped array of valid ContactTags. */
export function normalizeContactTags(raw: unknown): ContactTag[] {
  if (!Array.isArray(raw)) return [];
  const out: ContactTag[] = [];
  for (const v of raw) {
    if (typeof v === 'string' && CONTACT_TAG_SET.has(v as ContactTag) && !out.includes(v as ContactTag)) {
      out.push(v as ContactTag);
    }
  }
  return out;
}
