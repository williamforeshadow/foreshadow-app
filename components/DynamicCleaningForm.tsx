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
  currentAction: string;
  availableActions: { label: string; value: string }[];
  onSave: (formData: any) => Promise<void>;
  onActionChange: (action: string) => Promise<void>;
  onCancel: () => void;
}

export default function DynamicCleaningForm({ 
  cleaningId, 
  propertyName, 
  template,
  formMetadata,
  currentAction,
  availableActions,
  onSave,
  onActionChange,
  onCancel 
}: DynamicCleaningFormProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [isUpdatingAction, setIsUpdatingAction] = useState(false);

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

  const handleActionChange = async (action: string) => {
    setIsUpdatingAction(true);
    try {
      await onActionChange(action);
    } finally {
      setIsUpdatingAction(false);
    }
  };

  const handleComplete = async () => {
    await handleActionChange('completed');
  };

  const onSubmit = async (values: any) => {
    setIsSaving(true);
    try {
      await onSave({
        ...values,
        completed_at: new Date().toISOString(),
        property_name: propertyName,
        template_id: template?.id
      });
      await handleComplete();
    } finally {
      setIsSaving(false);
    }
  };

  const primaryAction = availableActions.find(action => action.value !== 'completed');

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

        {/* Primary Action Button (Start/Pause/Resume/Reopen) */}
        {primaryAction && (
          <Button
            onClick={() => handleActionChange(primaryAction.value)}
            disabled={isUpdatingAction}
            variant="outline"
            size="lg"
            className="w-full"
          >
            {primaryAction.label}
          </Button>
        )}

        {/* Dynamic Form */}
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {template.fields.map(field => renderField(field))}

            {/* Bottom Actions */}
            <div className="flex gap-3 pt-4 border-t">
              <Button 
                type="button" 
                onClick={onCancel} 
                variant="outline" 
                size="lg"
                className="flex-1"
              >
                Back
              </Button>
              <Button 
                type="submit"
                disabled={isSaving || isUpdatingAction}
                variant="default"
                size="lg"
                className="flex-1 bg-green-600 hover:bg-green-700"
              >
                {isSaving || isUpdatingAction ? 'Saving...' : 'Mark Complete'}
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </div>
  );
}

