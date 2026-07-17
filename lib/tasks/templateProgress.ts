import type { FieldDefinition, Template } from '@/components/DynamicCleaningForm';

// Progress semantics for templated tasks. Mirrors DynamicCleaningForm's
// per-type "filled" rules exactly, but counts per-field instead of the form's
// boolean all-or-nothing validation. The denominator is ALL non-separator
// template fields — form_metadata only contains touched fields, so counting
// metadata keys (the legacy approach) undercounts untouched fields.

type EnrichedValue = { label?: string; type?: string; value?: unknown };

// form_metadata values are either raw (old format) or { label, type, value }
// (new format). Unwrap to the raw value either way.
export function unwrapValue(v: unknown): unknown {
  if (v && typeof v === 'object' && !Array.isArray(v) && 'value' in (v as EnrichedValue)) {
    return (v as EnrichedValue).value;
  }
  return v;
}

export function isFieldSatisfied(type: FieldDefinition['type'], value: unknown): boolean {
  switch (type) {
    case 'checkbox':
      return value === true;
    case 'text':
      return typeof value === 'string' && value.trim() !== '';
    case 'rating':
    case 'yes-no':
      return value !== '' && value !== null && value !== undefined;
    case 'photo':
      return typeof value === 'string' && value !== '';
    case 'photos':
      return Array.isArray(value) && value.length > 0;
    case 'separator':
      return true; // excluded from counting; satisfied by definition
    default:
      return false;
  }
}

export interface TemplateProgress {
  completed: number;
  total: number;
  /** 0..1; 0 when the template has no countable fields. */
  fraction: number;
}

export function templateProgress(
  template: Template | null | undefined,
  formMetadata: Record<string, unknown> | null | undefined
): TemplateProgress {
  const fields = (template?.fields ?? []).filter((f) => f.type !== 'separator');
  const total = fields.length;
  if (total === 0) return { completed: 0, total: 0, fraction: 0 };
  let completed = 0;
  for (const field of fields) {
    const value = unwrapValue(formMetadata?.[field.id]);
    if (isFieldSatisfied(field.type, value)) completed++;
  }
  return { completed, total, fraction: completed / total };
}

// The Complete-confirm guard: true when the template has countable fields and
// any of them is unsatisfied. (Behavior matches the panels' legacy
// hasIncompleteChecklist, with the untouched-fields undercount fixed.)
export function hasIncompleteChecklist(
  template: Template | null | undefined,
  formMetadata: Record<string, unknown> | null | undefined
): boolean {
  const { completed, total } = templateProgress(template, formMetadata);
  return total > 0 && completed < total;
}

// Fallback for when the template body hasn't loaded yet: the legacy
// metadata-keys-only check, so Complete isn't blocked behind a fetch.
export function hasIncompleteChecklistFromMetadata(
  formMetadata: Record<string, unknown> | null | undefined
): boolean {
  if (!formMetadata) return false;
  return Object.entries(formMetadata).some(([key, raw]) => {
    if (key === 'property_name' || key === 'template_id' || key === 'template_name') return false;
    const enriched = raw as EnrichedValue | undefined;
    const type = (enriched && typeof enriched === 'object' && 'type' in enriched
      ? enriched.type
      : undefined) as FieldDefinition['type'] | undefined;
    if (type === 'separator') return false;
    const value = unwrapValue(raw);
    if (type) return !isFieldSatisfied(type, value);
    // Old-format raw values: treat empty-ish as incomplete.
    return value === '' || value === null || value === undefined || value === false;
  });
}
