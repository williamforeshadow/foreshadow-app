'use client';

import { useState, useEffect, useCallback, memo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
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

interface DynamicCleaningFormProps {
  cleaningId: string;
  propertyName: string;
  template: Template | null;
  formMetadata?: any;
  onSave: (formData: any) => Promise<void>;
  readOnly?: boolean;
  onValidationChange?: (allRequiredFilled: boolean) => void;
  onChecklistInteraction?: () => void;
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
            defaults[field.id] = '';
            break;
          case 'photos':
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
          return value !== undefined && value !== '';
        case 'photos':
          return Array.isArray(value) && value.length > 0;
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
              {field.label} {field.required && !readOnly && <span className="text-red-500">*</span>}
            </FieldLabel>
            <div className={`flex gap-2 ${readOnly ? 'pointer-events-none' : ''}`}>
              {[1, 2, 3, 4, 5].map((rating) => (
                <button
                  key={rating}
                  type="button"
                  onClick={() => updateValue(field.id, rating.toString())}
                  style={{ touchAction: 'manipulation' }}
                  tabIndex={readOnly ? -1 : undefined}
                  className={`w-12 h-12 rounded-lg border-2 text-sm font-medium transition-all ${
                    readOnly
                      ? 'border-neutral-200 dark:border-neutral-700 text-neutral-400 dark:text-neutral-600 opacity-50'
                      : value === rating.toString()
                        ? 'bg-emerald-500 border-emerald-500 text-white'
                        : 'border-neutral-300 dark:border-neutral-600 hover:border-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20'
                  }`}
                >
                  {rating}
                </button>
              ))}
            </div>
            <FieldDescription>Rate from 1 (poor) to 5 (excellent)</FieldDescription>
          </Field>
        );

      case 'yes-no':
        return (
          <Field key={field.id}>
            <FieldLabel>
              {field.label} {field.required && !readOnly && <span className="text-red-500">*</span>}
            </FieldLabel>
            <div className={`flex gap-3 ${readOnly ? 'pointer-events-none' : ''}`}>
              <button
                type="button"
                onClick={() => updateValue(field.id, 'yes')}
                style={{ touchAction: 'manipulation' }}
                tabIndex={readOnly ? -1 : undefined}
                className={`flex-1 py-3 px-5 rounded-lg border-2 text-sm font-medium transition-all ${
                  readOnly
                    ? 'border-neutral-200 dark:border-neutral-700 text-neutral-400 dark:text-neutral-600 opacity-50'
                    : value === 'yes'
                      ? 'bg-emerald-500 border-emerald-500 text-white'
                      : 'border-neutral-300 dark:border-neutral-600 hover:border-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20'
                }`}
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => updateValue(field.id, 'no')}
                style={{ touchAction: 'manipulation' }}
                tabIndex={readOnly ? -1 : undefined}
                className={`flex-1 py-3 px-5 rounded-lg border-2 text-sm font-medium transition-all ${
                  readOnly
                    ? 'border-neutral-200 dark:border-neutral-700 text-neutral-400 dark:text-neutral-600 opacity-50'
                    : value === 'no'
                      ? 'bg-red-500 border-red-500 text-white'
                      : 'border-neutral-300 dark:border-neutral-600 hover:border-red-400 hover:bg-red-50 dark:hover:bg-red-900/20'
                }`}
              >
                No
              </button>
            </div>
          </Field>
        );

      case 'checkbox':
        return (
          <Field key={field.id}>
            <button
              type="button"
              onClick={readOnly ? undefined : () => updateValue(field.id, !value)}
              className={`flex items-center justify-between gap-4 p-3 rounded-lg border border-transparent transition-colors w-full text-left ${
                readOnly
                  ? 'pointer-events-none'
                  : 'cursor-pointer group hover:border-neutral-200 dark:hover:border-neutral-700'
              }`}
              style={{ touchAction: 'manipulation' }}
              tabIndex={readOnly ? -1 : undefined}
            >
              <FieldLabel className={`!mb-0 ${readOnly ? '' : ''}`}>
                {field.label} {field.required && !readOnly && <span className="text-red-500">*</span>}
              </FieldLabel>
              <div className={`w-7 h-7 rounded-md border-2 flex items-center justify-center transition-all flex-shrink-0 ${
                readOnly
                  ? 'border-neutral-200 dark:border-neutral-700 opacity-50'
                  : value
                    ? 'bg-emerald-500 border-emerald-500'
                    : 'border-neutral-300 dark:border-neutral-600 group-hover:border-emerald-400'
              }`}>
                {value && !readOnly && (
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
              {field.label} {field.required && !readOnly && <span className="text-red-500">*</span>}
            </FieldLabel>
            {readOnly ? (
              <div className="flex items-center gap-2 py-3 px-4 rounded-lg border-2 border-dashed border-neutral-200 dark:border-neutral-700 opacity-50">
                <svg className="w-5 h-5 text-neutral-400 dark:text-neutral-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="text-sm text-neutral-400 dark:text-neutral-600">
                  {field.type === 'photos' ? 'Photo upload' : 'Photo upload'}
                </span>
              </div>
            ) : (
              <>
                <PhotoUpload
                  cleaningId={cleaningId}
                  fieldId={field.id}
                  value={value}
                  onChange={(newValue) => updateValue(field.id, newValue)}
                  multiple={field.type === 'photos'}
                  maxPhotos={field.options?.maxPhotos || 5}
                  required={field.required}
                />
                {field.type === 'photos' && (
                  <FieldDescription>Upload up to {field.options?.maxPhotos || 5} photos</FieldDescription>
                )}
              </>
            )}
          </Field>
        );

      case 'text':
      default:
        return (
          <Field key={field.id}>
            <FieldLabel>
              {field.label} {field.required && !readOnly && <span className="text-red-500">*</span>}
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
      {/* Header — hidden in readOnly preview */}
      {!readOnly && (
        <div className="text-center mb-6">
          <h3 className="text-lg font-semibold text-neutral-900 dark:text-white">
            {template.name}
          </h3>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
            {propertyName}
          </p>
        </div>
      )}

      {/* Dynamic Form */}
      <form onSubmit={(e) => { e.preventDefault(); if (!readOnly) saveForm(); }}>
        <div className="space-y-5">
          {template.fields.map(field => renderField(field))}
        </div>
      </form>
    </div>
  );
}

// Memoize to prevent re-renders when parent state changes
export default memo(DynamicCleaningForm);
