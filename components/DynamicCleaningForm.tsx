'use client';

import { useState, useEffect, useCallback, memo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldLabel,
} from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import PhotoUpload from '@/components/PhotoUpload';

export interface FieldDefinition {
  id: string;
  type: 'rating' | 'yes-no' | 'text' | 'checkbox' | 'photo' | 'photos' | 'separator';
  label: string;
  required: boolean;
  options?: {
    maxPhotos?: number;
    maxSizeMB?: number;
  };
}

export interface Template {
  id: string;
  name: string;
  fields: FieldDefinition[];
}

// Required marker — sized up so it actually registers next to the label.
function RequiredStar() {
  return (
    <span className="text-red-500 text-[1.2em] leading-none align-middle" aria-hidden>
      *
    </span>
  );
}

interface DynamicCleaningFormProps {
  cleaningId: string;
  propertyName: string;
  template: Template | null;
  formMetadata?: any;
  onSave: (formData: any) => Promise<void>;
  readOnly?: boolean;
  onValidationChange?: (allRequiredFilled: boolean) => void;
  onChecklistInteraction?: () => void;
  /** Render only these fields (a checklist section). State, autosave, and
   * validation still span the whole template — this is display-only. */
  visibleFieldIds?: string[];
}

function DynamicCleaningForm({ 
  cleaningId, 
  propertyName, 
  template, 
  formMetadata, 
  onSave,
  readOnly = false,
  onValidationChange,
  onChecklistInteraction,
  visibleFieldIds,
}: DynamicCleaningFormProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, any>>({});

  // Initialize form values from template fields and existing metadata
  // Handles both old format (raw values) and new format (objects with label/type/value)
  useEffect(() => {
    if (!template) return;
    
    const defaults: Record<string, any> = {};
    template.fields.forEach(field => {
      // Skip separators - they don't have values
      if (field.type === 'separator') return;
      
      if (formMetadata && formMetadata[field.id] !== undefined) {
        const stored = formMetadata[field.id];
        // Handle both old format (raw value) and new format (object with value property)
        defaults[field.id] = (typeof stored === 'object' && stored !== null && 'value' in stored)
          ? stored.value
          : stored;
      } else {
        // Set default based on field type
        switch (field.type) {
          case 'rating':
            defaults[field.id] = '';
            break;
          case 'yes-no':
            defaults[field.id] = '';
            break;
          case 'checkbox':
            defaults[field.id] = false;
            break;
          case 'photo':
          case 'photos':
            // Multi-photo now; a stored single-string snapshot (legacy 'photo')
            // is loaded from formMetadata and overrides this default.
            defaults[field.id] = [];
            break;
          case 'text':
          default:
            defaults[field.id] = '';
        }
      }
    });
    setFormValues(defaults);
  }, [template, formMetadata]);

  const hasInteractedRef = useRef(false);
  const updateValue = useCallback((fieldId: string, value: any) => {
    setFormValues(prev => ({ ...prev, [fieldId]: value }));
    if (!hasInteractedRef.current && onChecklistInteraction) {
      hasInteractedRef.current = true;
      onChecklistInteraction();
    }
  }, [onChecklistInteraction]);

  // Debounced auto-save on every field change
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      return;
    }
    if (readOnly) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      const enrichedFields: Record<string, any> = {};
      template?.fields.forEach(field => {
        if (field.type === 'separator') return;
        enrichedFields[field.id] = {
          label: field.label,
          type: field.type,
          value: formValues[field.id]
        };
      });
      onSave({
        ...enrichedFields,
        property_name: propertyName,
        template_id: template?.id,
        template_name: template?.name
      });
    }, 800);
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
  }, [formValues]);

  // Check if all required fields are filled and notify parent
  useEffect(() => {
    if (!onValidationChange || !template) return;

    const allFilled = template.fields.every(field => {
      if (field.type === 'separator') return true;
      if (!field.required) return true;

      const value = formValues[field.id];
      switch (field.type) {
        case 'rating':
        case 'yes-no':
        case 'text':
          return value !== undefined && value !== '';
        case 'checkbox':
          return value === true;
        case 'photo':
        case 'photos':
          // Multi-photo now; legacy 'photo' snapshots may still hold a string.
          return Array.isArray(value)
            ? value.length > 0
            : value !== undefined && value !== '';
        default:
          return value !== undefined && value !== '';
      }
    });

    onValidationChange(allFilled);
  }, [formValues, template, onValidationChange]);

  // Get current form values - exposed for external save
  // Enriched with labels so AI can understand field context
  const getFormValues = () => {
    const enrichedFields: Record<string, any> = {};
    
    template?.fields.forEach(field => {
      // Skip separators - they don't have values
      if (field.type === 'separator') return;
      
      enrichedFields[field.id] = {
        label: field.label,
        type: field.type,
        value: formValues[field.id]
      };
    });

    return {
      ...enrichedFields,
      property_name: propertyName,
      template_id: template?.id,
      template_name: template?.name
    };
  };

  // Save form and call onSave callback
  const saveForm = async () => {
    setIsSaving(true);
    try {
      await onSave(getFormValues());
    } finally {
      setIsSaving(false);
    }
  };

  // Use ref to always have access to latest form values without re-running effect
  const formValuesRef = useRef(formValues);
  formValuesRef.current = formValues;

  // Expose saveForm to parent via window - only set up once on mount
  useEffect(() => {
    // Store save function reference for parent to access
    (window as any).__currentFormSave = async () => {
      setIsSaving(true);
      try {
        const enrichedFields: Record<string, any> = {};
        template?.fields.forEach(field => {
          if (field.type === 'separator') return;
          enrichedFields[field.id] = {
            label: field.label,
            type: field.type,
            value: formValuesRef.current[field.id]
          };
        });
        await onSave({
          ...enrichedFields,
          property_name: propertyName,
          template_id: template?.id,
          template_name: template?.name
        });
      } finally {
        setIsSaving(false);
      }
    };
    return () => {
      delete (window as any).__currentFormSave;
    };
  }, [template, propertyName, onSave]);

  if (!template) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-neutral-500 dark:text-neutral-400">
          No template assigned to this property. Please assign a template first.
        </p>
      </div>
    );
  }

  const renderField = (field: FieldDefinition) => {
    const value = formValues[field.id];

    switch (field.type) {
      case 'separator':
        return (
          <div key={field.id} className="relative py-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-neutral-200 dark:border-neutral-700" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-white dark:bg-card px-3 text-sm text-neutral-500 dark:text-neutral-400">
                {field.label}
              </span>
            </div>
          </div>
        );

      case 'rating':
        return (
          <Field key={field.id}>
            <FieldLabel>
              {field.label} {field.required && !readOnly && <RequiredStar />}
            </FieldLabel>
            <div className={`flex w-full justify-center gap-3 py-2 ${readOnly ? 'pointer-events-none opacity-50' : ''}`}>
              {[1, 2, 3, 4, 5].map((rating) => {
                const active = Number(value) >= rating;
                return (
                  <button
                    key={rating}
                    type="button"
                    onClick={() => updateValue(field.id, rating.toString())}
                    style={{ touchAction: 'manipulation' }}
                    tabIndex={readOnly ? -1 : undefined}
                    aria-label={`${rating} of 5`}
                    className="transition-transform active:scale-90"
                  >
                    <svg
                      width="32"
                      height="32"
                      viewBox="0 0 24 24"
                      fill={active ? 'currentColor' : 'none'}
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                      className={
                        active
                          ? 'text-[#4C4869] dark:text-[#6e6a8a]'
                          : 'text-neutral-300 dark:text-neutral-600'
                      }
                    >
                      <path d="M12 4.5l2.3 4.9 5.2.7-3.8 3.7.9 5.2-4.6-2.5-4.6 2.5.9-5.2L4.5 10l5.2-.7z" />
                    </svg>
                  </button>
                );
              })}
            </div>
          </Field>
        );

      case 'yes-no':
        return (
          <Field key={field.id}>
            <FieldLabel>
              {field.label} {field.required && !readOnly && <RequiredStar />}
            </FieldLabel>
            <div className={`flex w-full justify-center gap-3 py-1 ${readOnly ? 'pointer-events-none' : ''}`}>
              {(['yes', 'no'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => updateValue(field.id, option)}
                  style={{ touchAction: 'manipulation' }}
                  tabIndex={readOnly ? -1 : undefined}
                  className={`w-20 py-2 rounded-lg border text-sm font-medium transition-all active:scale-95 ${
                    readOnly
                      ? 'border-neutral-200 dark:border-neutral-700 text-neutral-400 dark:text-neutral-600 opacity-50'
                      : value === option
                        ? 'border-transparent bg-[#4C4869]/[0.07] dark:bg-[#6e6a8a]/[0.16] text-[#4C4869] dark:text-[#6e6a8a]'
                        : 'border-neutral-300 dark:border-neutral-600 hover:border-[#A78BFA]'
                  }`}
                >
                  {option === 'yes' ? 'Yes' : 'No'}
                </button>
              ))}
            </div>
          </Field>
        );

      case 'checkbox':
        return (
          <Field key={field.id}>
            {/* px-3/-mx-3 keeps the label flush with every other field's left
                edge while giving the checked-state tint room to breathe.
                items-start pins the box to the label's top line. */}
            <button
              type="button"
              onClick={readOnly ? undefined : () => updateValue(field.id, !value)}
              className={`-mx-3 flex w-[calc(100%+1.5rem)] items-start justify-between gap-4 rounded-xl px-3 py-2.5 text-left transition-colors duration-200 ${
                readOnly ? 'pointer-events-none' : 'cursor-pointer group'
              } ${value ? 'bg-[#4C4869]/[0.07] dark:bg-[#6e6a8a]/[0.16]' : ''}`}
              style={{ touchAction: 'manipulation' }}
              tabIndex={readOnly ? -1 : undefined}
            >
              <FieldLabel className="!mb-0">
                {field.label} {field.required && !readOnly && <RequiredStar />}
              </FieldLabel>
              {/* Read-only still shows the checked state (dimmed) — a locked
                  checklist must remain legible. Checked = the app-wide
                  "complete" violet (task status, property readiness, tiptap
                  checklists), not green. */}
              <div className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-all flex-shrink-0 group-active:scale-90 ${
                value
                  ? readOnly
                    ? 'bg-[#4C4869]/60 dark:bg-[#6e6a8a]/60 border-transparent opacity-70'
                    : 'bg-[#4C4869] dark:bg-[#6e6a8a] border-transparent'
                  : readOnly
                    ? 'border-neutral-200 dark:border-neutral-700 opacity-50'
                    : 'border-neutral-300 dark:border-neutral-600 group-hover:border-[#A78BFA]'
              }`}>
                {value && (
                  <svg
                    className="w-3.5 h-3.5 text-white"
                    style={{ animation: 'check-pop 160ms ease-out' }}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
            </button>
          </Field>
        );

      case 'photo':
      case 'photos':
        return (
          <Field key={field.id}>
            <FieldLabel>
              {field.label} {field.required && !readOnly && <RequiredStar />}
            </FieldLabel>
            {readOnly ? (
              <div className="flex w-full items-center justify-center gap-2 py-3 px-4 rounded-lg border-2 border-dashed border-neutral-200 dark:border-neutral-700 opacity-50">
                <svg className="w-5 h-5 text-neutral-400 dark:text-neutral-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="text-sm text-neutral-400 dark:text-neutral-600">
                  {field.type === 'photos' ? 'Photo upload' : 'Photo upload'}
                </span>
              </div>
            ) : (
              <PhotoUpload
                cleaningId={cleaningId}
                fieldId={field.id}
                value={value}
                onChange={(newValue) => updateValue(field.id, newValue)}
                // Both the current 'photos' type and the legacy single 'photo'
                // type are multi-photo inputs now — the read paths below and in
                // templateProgress/getTask tolerate the old single-string shape.
                multiple
                // Hard cap, not configurable — need more, add a second field.
                maxPhotos={20}
                required={field.required}
              />
            )}
          </Field>
        );

      case 'text':
      default:
        return (
          <Field key={field.id}>
            <FieldLabel>
              {field.label} {field.required && !readOnly && <RequiredStar />}
            </FieldLabel>
            <Textarea
              value={value || ''}
              onChange={(e) => updateValue(field.id, e.target.value)}
              placeholder={readOnly ? '' : `Enter ${field.label.toLowerCase()}`}
              rows={readOnly ? 2 : 3}
              className={`resize-none ${readOnly ? 'pointer-events-none opacity-50 !bg-transparent' : ''}`}
              readOnly={readOnly}
              tabIndex={readOnly ? -1 : undefined}
            />
          </Field>
        );
    }
  };

  return (
    <div className={`w-full ${readOnly ? 'opacity-60' : ''}`}>
      {/* No header here — ChecklistPage owns the page chrome in both states. */}
      {/* Dynamic Form — hairline separators between fields */}
      <style>{`@keyframes check-pop { from { transform: scale(0.4); opacity: 0 } }`}</style>
      <form onSubmit={(e) => { e.preventDefault(); if (!readOnly) saveForm(); }}>
        <div className="divide-y divide-[var(--task-line-soft)]">
          {(visibleFieldIds
            ? template.fields.filter(f => visibleFieldIds.includes(f.id))
            : template.fields
          ).map(field => (
            <div key={field.id} className="py-5 first:pt-1 last:pb-2">
              {renderField(field)}
            </div>
          ))}
        </div>
      </form>
    </div>
  );
}

// Memoize to prevent re-renders when parent state changes
export default memo(DynamicCleaningForm);
