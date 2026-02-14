import type { FieldOverrides } from '@/lib/types';

/**
 * Field definition as stored in the `templates.fields` JSONB column.
 * Matches the FieldDefinition interface in DynamicCleaningForm.
 */
export interface TemplateField {
  id: string;
  type: 'rating' | 'yes-no' | 'text' | 'checkbox' | 'photo' | 'photos' | 'separator';
  label: string;
  required: boolean;
  options?: {
    maxPhotos?: number;
    maxSizeMB?: number;
  };
}

/**
 * Merge base template fields with property-level overrides.
 *
 * 1. Remove fields whose `id` appears in `overrides.removed_field_ids`.
 * 2. Apply label / required modifications from `overrides.modified_fields`.
 * 3. Append `overrides.additional_fields` at the end.
 *
 * If `overrides` is null / undefined the base fields are returned unchanged.
 */
export function mergeTemplateFields(
  baseFields: TemplateField[],
  overrides?: FieldOverrides | null,
): TemplateField[] {
  if (!overrides) return baseFields;

  const removedIds = new Set(overrides.removed_field_ids ?? []);
  const modifications = overrides.modified_fields ?? {};
  const additional = (overrides.additional_fields ?? []) as TemplateField[];

  // Step 1 & 2: filter out removed, apply modifications
  const merged = baseFields
    .filter((f) => !removedIds.has(f.id))
    .map((f) => {
      const mod = modifications[f.id];
      if (!mod) return f;
      return {
        ...f,
        ...(mod.label !== undefined && { label: mod.label }),
        ...(mod.required !== undefined && { required: mod.required }),
      };
    });

  // Step 3: append additional fields
  return [...merged, ...additional];
}
