'use client';

import * as React from 'react';

// Glyphs for checklist field types, in the same house style as the task
// panel's icon set (24 viewBox, stroke 1.5, round caps) so a field list reads
// like the rest of the app's rows.

export type FieldType =
  | 'rating'
  | 'yes-no'
  | 'text'
  | 'checkbox'
  | 'photo'
  | 'photos'
  | 'separator';

/** Full labels — used wherever a type is *chosen* (pickers). */
export const FIELD_TYPE_OPTIONS: { value: FieldType; label: string }[] = [
  { value: 'rating', label: 'Rating (1-5)' },
  { value: 'yes-no', label: 'Yes/No' },
  { value: 'text', label: 'Text' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'photo', label: 'Photo (Single)' },
  { value: 'photos', label: 'Photos (Multiple)' },
  { value: 'separator', label: 'Section Separator' },
];

/** Compact labels — used where a type is merely *shown* (row chips). */
const FIELD_TYPE_SHORT: Record<FieldType, string> = {
  rating: 'Rating',
  'yes-no': 'Yes/No',
  text: 'Text',
  checkbox: 'Checkbox',
  photo: 'Photo',
  photos: 'Photos',
  separator: 'Separator',
};

export function fieldTypeShortLabel(type: FieldType): string {
  return FIELD_TYPE_SHORT[type] ?? type;
}

export function fieldTypeLabel(type: FieldType): string {
  return FIELD_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;
}

const PATHS: Record<FieldType, React.ReactNode> = {
  rating: <path d="M12 4.5l2.3 4.9 5.2.7-3.8 3.7.9 5.2-4.6-2.5-4.6 2.5.9-5.2L4.5 10l5.2-.7z" />,
  'yes-no': (
    <>
      <rect x="2.5" y="7" width="19" height="10" rx="5" />
      <circle cx="16.5" cy="12" r="2.6" />
    </>
  ),
  text: <path d="M4 6h16M4 12h12M4 18h8" />,
  checkbox: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M8.5 12.2l2.4 2.4 4.6-5" />
    </>
  ),
  photo: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
      <circle cx="9" cy="10.5" r="1.6" />
      <path d="M4 17l4.8-4.3a1.6 1.6 0 012.2 0L16 17" />
    </>
  ),
  photos: (
    <>
      <rect x="7" y="3.5" width="14" height="11" rx="2.5" />
      <path d="M17 18.5a2 2 0 01-2 2H5a2 2 0 01-2-2v-9" />
      <circle cx="11.5" cy="7.6" r="1.4" />
    </>
  ),
  separator: (
    <>
      <path d="M3 12h18" />
      <path d="M6 7h12M6 17h12" opacity="0.4" />
    </>
  ),
};

export function FieldTypeGlyph({ type, size = 17 }: { type: FieldType; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {PATHS[type] ?? PATHS.text}
    </svg>
  );
}
