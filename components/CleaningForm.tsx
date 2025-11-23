'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
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

const formSchema = z.object({
  rating: z.string().min(1, 'Please rate the home'),
  bedrooms_clean: z.enum(['yes', 'no']),
  bathrooms_clean: z.enum(['yes', 'no']),
  living_rooms_clean: z.enum(['yes', 'no']),
  issues: z.string().optional(),
});

type FormData = z.infer<typeof formSchema>;

interface CleaningFormProps {
  cleaningId: string;
  propertyName: string;
  formMetadata?: any;
  currentAction: string;
  availableActions: { label: string; value: string }[];
  onSave: (formData: any) => Promise<void>;
  onActionChange: (action: string) => Promise<void>;
  onCancel: () => void;
}

export default function CleaningForm({ 
  cleaningId, 
  propertyName, 
  formMetadata,
  currentAction,
  availableActions,
  onSave,
  onActionChange,
  onCancel 
}: CleaningFormProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [isUpdatingAction, setIsUpdatingAction] = useState(false);

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      rating: formMetadata?.rating || '',
      bedrooms_clean: formMetadata?.bedrooms_clean || 'yes',
      bathrooms_clean: formMetadata?.bathrooms_clean || 'yes',
      living_rooms_clean: formMetadata?.living_rooms_clean || 'yes',
      issues: formMetadata?.issues || '',
    },
  });

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

  const onSubmit = async (values: FormData) => {
    setIsSaving(true);
    try {
      // Save form data first
      await onSave({
        ...values,
        completed_at: new Date().toISOString(),
        property_name: propertyName
      });
      // Then mark as complete
      await handleComplete();
    } finally {
      setIsSaving(false);
    }
  };

  // Get the primary action button (excluding "Mark Complete")
  const primaryAction = availableActions.find(action => action.value !== 'completed');

  return (
    <div className="flex items-center justify-center py-6">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center border-b pb-4">
          <h3 className="text-xl font-semibold text-slate-900 dark:text-white">
            Cleaning Form
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

        {/* Cleaning Form */}
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            
            {/* Rating */}
            <FormField
              control={form.control}
              name="rating"
              render={({ field }) => (
                <FormItem className="space-y-3">
                  <FormLabel className="text-base">Rate Home</FormLabel>
                  <FormControl>
                    <RadioGroup
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      className="flex justify-center gap-3"
                    >
                      {[1, 2, 3, 4, 5].map((star) => (
                        <FormItem key={star} className="flex items-center space-x-1 space-y-0">
                          <FormControl>
                            <RadioGroupItem value={star.toString()} />
                          </FormControl>
                          <FormLabel className="font-normal cursor-pointer text-lg">
                            {star}★
                          </FormLabel>
                        </FormItem>
                      ))}
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Bedrooms Clean */}
            <FormField
              control={form.control}
              name="bedrooms_clean"
              render={({ field }) => (
                <FormItem className="space-y-3">
                  <FormLabel className="text-base">Bedrooms Clean?</FormLabel>
                  <FormControl>
                    <RadioGroup
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      className="flex justify-center gap-6"
                    >
                      <FormItem className="flex items-center space-x-2 space-y-0">
                        <FormControl>
                          <RadioGroupItem value="yes" />
                        </FormControl>
                        <FormLabel className="font-normal cursor-pointer text-base">
                          Yes
                        </FormLabel>
                      </FormItem>
                      <FormItem className="flex items-center space-x-2 space-y-0">
                        <FormControl>
                          <RadioGroupItem value="no" />
                        </FormControl>
                        <FormLabel className="font-normal cursor-pointer text-base">
                          No
                        </FormLabel>
                      </FormItem>
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Bathrooms Clean */}
            <FormField
              control={form.control}
              name="bathrooms_clean"
              render={({ field }) => (
                <FormItem className="space-y-3">
                  <FormLabel className="text-base">Bathrooms Clean?</FormLabel>
                  <FormControl>
                    <RadioGroup
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      className="flex justify-center gap-6"
                    >
                      <FormItem className="flex items-center space-x-2 space-y-0">
                        <FormControl>
                          <RadioGroupItem value="yes" />
                        </FormControl>
                        <FormLabel className="font-normal cursor-pointer text-base">
                          Yes
                        </FormLabel>
                      </FormItem>
                      <FormItem className="flex items-center space-x-2 space-y-0">
                        <FormControl>
                          <RadioGroupItem value="no" />
                        </FormControl>
                        <FormLabel className="font-normal cursor-pointer text-base">
                          No
                        </FormLabel>
                      </FormItem>
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Living Rooms Clean */}
            <FormField
              control={form.control}
              name="living_rooms_clean"
              render={({ field }) => (
                <FormItem className="space-y-3">
                  <FormLabel className="text-base">Living Rooms Clean?</FormLabel>
                  <FormControl>
                    <RadioGroup
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      className="flex justify-center gap-6"
                    >
                      <FormItem className="flex items-center space-x-2 space-y-0">
                        <FormControl>
                          <RadioGroupItem value="yes" />
                        </FormControl>
                        <FormLabel className="font-normal cursor-pointer text-base">
                          Yes
                        </FormLabel>
                      </FormItem>
                      <FormItem className="flex items-center space-x-2 space-y-0">
                        <FormControl>
                          <RadioGroupItem value="no" />
                        </FormControl>
                        <FormLabel className="font-normal cursor-pointer text-base">
                          No
                        </FormLabel>
                      </FormItem>
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Issues */}
            <FormField
              control={form.control}
              name="issues"
              render={({ field }) => (
                <FormItem className="space-y-3">
                  <FormLabel className="text-base">Any Other Issues?</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Describe any issues or concerns..."
                      className="resize-none min-h-[100px]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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
