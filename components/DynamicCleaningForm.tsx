'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import PhotoUpload from '@/components/PhotoUpload';

interface FieldDefinition {
  id: string;
  type: 'rating' | 'yes-no' | 'text' | 'checkbox' | 'photo' | 'photos';
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

  // Create default values from template fields and existing metadata
  const getDefaultValues = () => {
    if (!template) return {};
    
    const defaults: any = {};
    template.fields.forEach(field => {
      if (formMetadata && formMetadata[field.id] !== undefined) {
        defaults[field.id] = formMetadata[field.id];
      } else {
        // Set default based on field type
        switch (field.type) {
          case 'rating':
            defaults[field.id] = '';
            break;
          case 'yes-no':
            defaults[field.id] = 'yes';
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
    return defaults;
  };

  const form = useForm({
    defaultValues: getDefaultValues(),
  });

  // Reset form when template or formMetadata changes
  useEffect(() => {
    form.reset(getDefaultValues());
  }, [template, formMetadata]);

  // Get current form values - exposed for external save
  const getFormValues = () => {
    return {
      ...form.getValues(),
      property_name: propertyName,
      template_id: template?.id
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
  }, []);

  if (!template) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-slate-500 dark:text-slate-400">
          No template assigned to this property. Please assign a template first.
        </p>
      </div>
    );
  }

  const renderField = (field: FieldDefinition) => {
    switch (field.type) {
      case 'rating':
        return (
          <FormField
            key={field.id}
            control={form.control}
            name={field.id}
            render={({ field: formField }) => (
              <FormItem>
                <FormLabel>
                  {field.label} {field.required && <span className="text-red-500">*</span>}
                </FormLabel>
                <FormControl>
                  <RadioGroup
                    onValueChange={formField.onChange}
                    value={formField.value}
                    className="flex gap-4"
                  >
                    {[1, 2, 3, 4, 5].map((rating) => (
                      <div key={rating} className="flex items-center">
                        <RadioGroupItem value={rating.toString()} id={`${field.id}-${rating}`} />
                        <label htmlFor={`${field.id}-${rating}`} className="ml-2 cursor-pointer">
                          {rating}
                        </label>
                      </div>
                    ))}
                  </RadioGroup>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        );

      case 'yes-no':
        return (
          <FormField
            key={field.id}
            control={form.control}
            name={field.id}
            render={({ field: formField }) => (
              <FormItem>
                <FormLabel>
                  {field.label} {field.required && <span className="text-red-500">*</span>}
                </FormLabel>
                <FormControl>
                  <RadioGroup
                    onValueChange={formField.onChange}
                    value={formField.value}
                    className="flex gap-4"
                  >
                    <div className="flex items-center">
                      <RadioGroupItem value="yes" id={`${field.id}-yes`} />
                      <label htmlFor={`${field.id}-yes`} className="ml-2 cursor-pointer">
                        Yes
                      </label>
                    </div>
                    <div className="flex items-center">
                      <RadioGroupItem value="no" id={`${field.id}-no`} />
                      <label htmlFor={`${field.id}-no`} className="ml-2 cursor-pointer">
                        No
                      </label>
                    </div>
                  </RadioGroup>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        );

      case 'checkbox':
        return (
          <FormField
            key={field.id}
            control={form.control}
            name={field.id}
            render={({ field: formField }) => (
              <FormItem className="flex items-center gap-2">
                <FormControl>
                  <input
                    type="checkbox"
                    checked={formField.value}
                    onChange={formField.onChange}
                    className="w-4 h-4"
                  />
                </FormControl>
                <FormLabel className="!mt-0">
                  {field.label} {field.required && <span className="text-red-500">*</span>}
                </FormLabel>
                <FormMessage />
              </FormItem>
            )}
          />
        );

      case 'photo':
      case 'photos':
        return (
          <FormField
            key={field.id}
            control={form.control}
            name={field.id}
            render={({ field: formField }) => (
              <FormItem>
                <FormLabel>
                  {field.label} {field.required && <span className="text-red-500">*</span>}
                </FormLabel>
                <FormControl>
                  <PhotoUpload
                    cleaningId={cleaningId}
                    fieldId={field.id}
                    value={formField.value}
                    onChange={formField.onChange}
                    multiple={field.type === 'photos'}
                    maxPhotos={field.options?.maxPhotos || 5}
                    required={field.required}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        );

      case 'text':
      default:
        return (
          <FormField
            key={field.id}
            control={form.control}
            name={field.id}
            render={({ field: formField }) => (
              <FormItem>
                <FormLabel>
                  {field.label} {field.required && <span className="text-red-500">*</span>}
                </FormLabel>
                <FormControl>
                  <Textarea
                    {...formField}
                    placeholder={`Enter ${field.label.toLowerCase()}`}
                    rows={3}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        );
    }
  };

  return (
    <div className="flex items-center justify-center py-6">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center border-b pb-4">
          <h3 className="text-xl font-semibold text-slate-900 dark:text-white">
            {template.name}
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {propertyName}
          </p>
        </div>

        {/* Dynamic Form */}
        <Form {...form}>
          <div className="space-y-6">
            {template.fields.map(field => renderField(field))}
          </div>
        </Form>
      </div>
    </div>
  );
}

