'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldLabel,
} from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import PhotoUpload from '@/components/PhotoUpload';

interface FieldDefinition {
  id: string;
  type: 'rating' | 'yes-no' | 'text' | 'checkbox' | 'photo' | 'photos' | 'separator';
  label: string;
  required: boolean;
  options?: {
    maxPhotos?: number;
    maxSizeMB?: number;
  };
}

interface Template {
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
}

export default function DynamicCleaningForm({ 
  cleaningId, 
  propertyName, 
  template, 
  formMetadata, 
  onSave
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

  const updateValue = (fieldId: string, value: any) => {
    setFormValues(prev => ({ ...prev, [fieldId]: value }));
  };

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

  // Expose saveForm to parent via ref or callback on mount
  useEffect(() => {
    // Store save function reference for parent to access
    (window as any).__currentFormSave = saveForm;
    return () => {
      delete (window as any).__currentFormSave;
    };
  }, [formValues]);

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
              <span className="bg-white dark:bg-neutral-900 px-3 text-sm text-neutral-500 dark:text-neutral-400">
                {field.label}
              </span>
            </div>
          </div>
        );

      case 'rating':
        return (
          <Field key={field.id}>
            <FieldLabel>
              {field.label} {field.required && <span className="text-red-500">*</span>}
            </FieldLabel>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((rating) => (
                <button
                  key={rating}
                  type="button"
                  onClick={() => updateValue(field.id, rating.toString())}
                  className={`w-12 h-12 rounded-lg border-2 text-sm font-medium transition-all ${
                    value === rating.toString()
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
              {field.label} {field.required && <span className="text-red-500">*</span>}
            </FieldLabel>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => updateValue(field.id, 'yes')}
                className={`flex-1 py-3 px-5 rounded-lg border-2 text-sm font-medium transition-all ${
                  value === 'yes'
                    ? 'bg-emerald-500 border-emerald-500 text-white'
                    : 'border-neutral-300 dark:border-neutral-600 hover:border-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20'
                }`}
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => updateValue(field.id, 'no')}
                className={`flex-1 py-3 px-5 rounded-lg border-2 text-sm font-medium transition-all ${
                  value === 'no'
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
          <Field key={field.id} orientation="horizontal">
            <label className="flex items-center gap-4 cursor-pointer group p-3 rounded-lg border border-transparent hover:border-neutral-200 dark:hover:border-neutral-700 transition-colors w-full">
              <div className={`w-7 h-7 rounded-md border-2 flex items-center justify-center transition-all flex-shrink-0 ${
                value
                  ? 'bg-emerald-500 border-emerald-500'
                  : 'border-neutral-300 dark:border-neutral-600 group-hover:border-emerald-400'
              }`}>
                {value && (
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
              <input
                type="checkbox"
                checked={value || false}
                onChange={(e) => updateValue(field.id, e.target.checked)}
                className="sr-only"
              />
              <span className="text-sm font-medium text-neutral-900 dark:text-white">
                {field.label} {field.required && <span className="text-red-500">*</span>}
              </span>
            </label>
          </Field>
        );

      case 'photo':
      case 'photos':
        return (
          <Field key={field.id}>
            <FieldLabel>
              {field.label} {field.required && <span className="text-red-500">*</span>}
            </FieldLabel>
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
          </Field>
        );

      case 'text':
      default:
        return (
          <Field key={field.id}>
            <FieldLabel>
              {field.label} {field.required && <span className="text-red-500">*</span>}
            </FieldLabel>
            <Textarea
              value={value || ''}
              onChange={(e) => updateValue(field.id, e.target.value)}
              placeholder={`Enter ${field.label.toLowerCase()}`}
              rows={3}
              className="resize-none"
            />
          </Field>
        );
    }
  };

  return (
    <div className="w-full">
      {/* Header */}
      <div className="text-center mb-6">
        <h3 className="text-lg font-semibold text-neutral-900 dark:text-white">
          {template.name}
        </h3>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
          {propertyName}
        </p>
      </div>

      {/* Dynamic Form */}
      <form onSubmit={(e) => { e.preventDefault(); saveForm(); }}>
        <div className="space-y-5">
          {template.fields.map(field => renderField(field))}
        </div>
      </form>
    </div>
  );
}
