'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { FieldOverrides, FieldOverrideEntry, FieldModification } from '@/lib/types';

// ============================================================================
// Types
// ============================================================================

type FieldType = 'rating' | 'yes-no' | 'text' | 'checkbox' | 'photo' | 'photos' | 'separator';

interface BaseField {
  id: string;
  type: FieldType;
  label: string;
  required: boolean;
}

interface FieldOverridesEditorProps {
  /** Base fields from the master template */
  baseFields: BaseField[];
  /** Current overrides (null = no customisations yet) */
  overrides: FieldOverrides | null;
  /** Called whenever the overrides change */
  onChange: (overrides: FieldOverrides) => void;
}

const FIELD_TYPE_OPTIONS: { value: FieldType; label: string }[] = [
  { value: 'rating', label: 'Rating (1-5)' },
  { value: 'yes-no', label: 'Yes/No' },
  { value: 'text', label: 'Text' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'photo', label: 'Photo (Single)' },
  { value: 'photos', label: 'Photos (Multiple)' },
  { value: 'separator', label: 'Section Separator' },
];

// ============================================================================
// Component
// ============================================================================

export default function FieldOverridesEditor({
  baseFields,
  overrides,
  onChange,
}: FieldOverridesEditorProps) {
  // Local working copy
  const [removedIds, setRemovedIds] = useState<Set<string>>(
    new Set(overrides?.removed_field_ids ?? [])
  );
  const [modifications, setModifications] = useState<Record<string, FieldModification>>(
    overrides?.modified_fields ?? {}
  );
  const [additionalFields, setAdditionalFields] = useState<FieldOverrideEntry[]>(
    overrides?.additional_fields ?? []
  );

  // Sync local state back to parent whenever anything changes
  useEffect(() => {
    onChange({
      additional_fields: additionalFields,
      removed_field_ids: Array.from(removedIds),
      modified_fields: modifications,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [removedIds, modifications, additionalFields]);

  // ────────────────────────────────────────
  // Handlers for base field overrides
  // ────────────────────────────────────────
  const toggleRemoveField = (fieldId: string) => {
    setRemovedIds((prev) => {
      const next = new Set(prev);
      if (next.has(fieldId)) {
        next.delete(fieldId);
      } else {
        next.add(fieldId);
      }
      return next;
    });
  };

  const updateModification = (fieldId: string, key: keyof FieldModification, value: string | boolean) => {
    setModifications((prev) => ({
      ...prev,
      [fieldId]: {
        ...prev[fieldId],
        [key]: value,
      },
    }));
  };

  const clearModification = (fieldId: string) => {
    setModifications((prev) => {
      const next = { ...prev };
      delete next[fieldId];
      return next;
    });
  };

  // ────────────────────────────────────────
  // Handlers for additional fields
  // ────────────────────────────────────────
  const addField = (type: FieldType) => {
    const defaultLabels: Record<FieldType, string> = {
      rating: 'Rating',
      'yes-no': 'Question',
      text: 'Notes',
      checkbox: 'Completed',
      photo: 'Photo',
      photos: 'Photos',
      separator: 'Section Title',
    };

    setAdditionalFields((prev) => [
      ...prev,
      {
        id: `custom_${Date.now()}`,
        type,
        label: defaultLabels[type],
        required: false,
      },
    ]);
  };

  const updateAdditionalField = (index: number, updates: Partial<FieldOverrideEntry>) => {
    setAdditionalFields((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...updates };
      return next;
    });
  };

  const removeAdditionalField = (index: number) => {
    setAdditionalFields((prev) => prev.filter((_, i) => i !== index));
  };

  // ────────────────────────────────────────
  // Render
  // ────────────────────────────────────────
  const hasAnyOverrides =
    removedIds.size > 0 ||
    Object.keys(modifications).length > 0 ||
    additionalFields.length > 0;

  return (
    <div className="space-y-6">
      {/* ── Base Template Fields ── */}
      <div>
        <h4 className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-3">
          Base Template Fields
        </h4>
        <p className="text-xs text-neutral-500 mb-3">
          Toggle fields off to hide them for this property, or click the label to rename it.
        </p>

        <div className="space-y-2">
          {baseFields.map((field) => {
            const isRemoved = removedIds.has(field.id);
            const mod = modifications[field.id];
            const displayLabel = mod?.label ?? field.label;
            const isModified = !!mod;

            return (
              <div
                key={field.id}
                className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                  isRemoved
                    ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800 opacity-60'
                    : isModified
                    ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800'
                    : 'bg-neutral-50 dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700'
                }`}
              >
                {/* Toggle visibility */}
                <button
                  type="button"
                  onClick={() => toggleRemoveField(field.id)}
                  className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                    isRemoved
                      ? 'border-red-400 bg-red-100 dark:bg-red-900'
                      : 'border-emerald-400 bg-emerald-100 dark:bg-emerald-900'
                  }`}
                  title={isRemoved ? 'Re-enable this field' : 'Hide this field for this property'}
                >
                  {!isRemoved && (
                    <svg className="w-3 h-3 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  {isRemoved && (
                    <svg className="w-3 h-3 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  )}
                </button>

                {/* Field info & editable label */}
                <div className="flex-1 min-w-0">
                  {!isRemoved ? (
                    <Input
                      value={displayLabel}
                      onChange={(e) => updateModification(field.id, 'label', e.target.value)}
                      className="h-8 text-sm"
                      placeholder={field.label}
                    />
                  ) : (
                    <span className="text-sm line-through text-neutral-400">{field.label}</span>
                  )}
                </div>

                {/* Type badge */}
                <Badge variant="outline" className="text-xs shrink-0">
                  {field.type}
                </Badge>

                {/* Reset button for modified fields */}
                {isModified && !isRemoved && (
                  <button
                    type="button"
                    onClick={() => clearModification(field.id)}
                    className="text-xs text-amber-600 hover:text-amber-700 shrink-0"
                    title="Reset to base template value"
                  >
                    Reset
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Additional Fields (property-specific) ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Additional Fields for this Property
          </h4>
        </div>

        {additionalFields.length > 0 && (
          <div className="space-y-2 mb-3">
            {additionalFields.map((field, index) => (
              <div
                key={field.id}
                className="flex items-center gap-3 p-3 rounded-lg border bg-purple-50 dark:bg-purple-900/10 border-purple-200 dark:border-purple-800"
              >
                {/* Label input */}
                <div className="flex-1 min-w-0">
                  <Input
                    value={field.label}
                    onChange={(e) => updateAdditionalField(index, { label: e.target.value })}
                    className="h-8 text-sm"
                    placeholder="Field label"
                  />
                </div>

                {/* Type selector */}
                <Select
                  value={field.type}
                  onValueChange={(value) => updateAdditionalField(index, { type: value as FieldType })}
                >
                  <SelectTrigger className="w-[140px] h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FIELD_TYPE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Required toggle */}
                {field.type !== 'separator' && (
                  <button
                    type="button"
                    onClick={() => updateAdditionalField(index, { required: !field.required })}
                    className={`text-xs px-2 py-1 rounded border ${
                      field.required
                        ? 'bg-red-100 dark:bg-red-900/30 border-red-300 text-red-700'
                        : 'bg-neutral-100 dark:bg-neutral-800 border-neutral-300 text-neutral-500'
                    }`}
                  >
                    {field.required ? 'Required' : 'Optional'}
                  </button>
                )}

                {/* Delete */}
                <button
                  type="button"
                  onClick={() => removeAdditionalField(index)}
                  className="text-red-500 hover:text-red-700 p-1"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add field dropdown */}
        <Select onValueChange={(value) => addField(value as FieldType)}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="+ Add a property-specific field..." />
          </SelectTrigger>
          <SelectContent>
            {FIELD_TYPE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Summary */}
      {hasAnyOverrides && (
        <div className="text-xs text-neutral-500 p-3 bg-neutral-50 dark:bg-neutral-800 rounded-lg">
          <span className="font-medium">Summary:</span>{' '}
          {removedIds.size > 0 && <span>{removedIds.size} field{removedIds.size !== 1 ? 's' : ''} hidden. </span>}
          {Object.keys(modifications).length > 0 && (
            <span>{Object.keys(modifications).length} field{Object.keys(modifications).length !== 1 ? 's' : ''} modified. </span>
          )}
          {additionalFields.length > 0 && (
            <span>{additionalFields.length} field{additionalFields.length !== 1 ? 's' : ''} added.</span>
          )}
        </div>
      )}
    </div>
  );
}
