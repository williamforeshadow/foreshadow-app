'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Field,
  FieldError,
  FieldLabel,
  FieldSeparator,
  FieldTitle,
} from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type FieldType = 'rating' | 'yes-no' | 'text' | 'checkbox' | 'photo' | 'photos' | 'separator';

interface FieldDefinition {
  id: string;
  type: FieldType;
  label: string;
  required: boolean;
  options?: {
    maxPhotos?: number;
    maxSizeMB?: number;
  };
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

interface TemplateEditorProps {
  /** null = creating new template */
  templateId: string | null;
  initialName?: string;
  initialType?: 'cleaning' | 'maintenance';
  initialDescription?: string;
  initialFields?: FieldDefinition[];
}

export default function TemplateEditor({
  templateId,
  initialName = '',
  initialType = 'cleaning',
  initialDescription = '',
  initialFields = [],
}: TemplateEditorProps) {
  const router = useRouter();
  const isEditing = !!templateId;

  const [formName, setFormName] = useState(initialName);
  const [formType, setFormType] = useState<'cleaning' | 'maintenance'>(initialType);
  const [formDescription, setFormDescription] = useState(initialDescription);
  const [fields, setFields] = useState<FieldDefinition[]>(initialFields);
  const [formErrors, setFormErrors] = useState<{ name?: string }>({});
  const [isSaving, setIsSaving] = useState(false);

  const addField = (type: FieldType) => {
    const newField: FieldDefinition = {
      id: `field_${Date.now()}`,
      type,
      label: '',
      required: false,
    };
    setFields([...fields, newField]);
  };

  const updateField = (index: number, updates: Partial<FieldDefinition>) => {
    const newFields = [...fields];
    newFields[index] = { ...newFields[index], ...updates };
    setFields(newFields);
  };

  const removeField = (index: number) => {
    setFields(fields.filter((_, i) => i !== index));
  };

  const moveFieldUp = (index: number) => {
    if (index === 0) return;
    const newFields = [...fields];
    [newFields[index - 1], newFields[index]] = [newFields[index], newFields[index - 1]];
    setFields(newFields);
  };

  const moveFieldDown = (index: number) => {
    if (index === fields.length - 1) return;
    const newFields = [...fields];
    [newFields[index], newFields[index + 1]] = [newFields[index + 1], newFields[index]];
    setFields(newFields);
  };

  const saveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();

    const errors: { name?: string } = {};
    if (!formName.trim()) {
      errors.name = 'Template name is required';
    }
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        name: formName,
        type: formType,
        description: formDescription || null,
        fields,
      };

      if (isEditing) {
        const res = await fetch(`/api/templates/${templateId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Failed to update template');
      } else {
        const res = await fetch('/api/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Failed to create template');
      }

      router.push('/templates');
    } catch (err) {
      console.error('Error saving template:', err);
      alert('Failed to save template');
    } finally {
      setIsSaving(false);
    }
  };

  const deleteTemplate = async () => {
    if (!templateId) return;
    if (!confirm('Are you sure you want to delete this template? This cannot be undone.')) return;

    try {
      const res = await fetch(`/api/templates/${templateId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete template');
      router.push('/templates');
    } catch (err) {
      console.error('Error deleting template:', err);
      alert('Failed to delete template');
    }
  };

  return (
    <div className="h-screen bg-neutral-50 dark:bg-neutral-950 flex flex-col items-center">
      {/* Scrollable content */}
      <div
        style={{ width: '100%', maxWidth: '48rem' }}
        className="px-8 py-10 flex-1 overflow-y-auto"
      >
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-white mb-10">
          {isEditing ? 'Edit Template' : 'New Template'}
        </h1>

        <form onSubmit={saveTemplate} className="flex flex-col gap-8">
          {/* ============================================================
              Template Details
              ============================================================ */}
          <div className="flex flex-col gap-6">
              <Field>
                <FieldLabel>Template Name</FieldLabel>
                <Input
                  placeholder="e.g., Standard Clean, Deep Clean"
                  value={formName}
                  onChange={(e) => {
                    setFormName(e.target.value);
                    if (formErrors.name) setFormErrors({});
                  }}
                  disabled={isSaving}
                  required
                />
                {formErrors.name && <FieldError>{formErrors.name}</FieldError>}
              </Field>

              <Field>
                <FieldLabel>Template Type</FieldLabel>
                <Select
                  onValueChange={(value) => setFormType(value as 'cleaning' | 'maintenance')}
                  value={formType}
                  disabled={isSaving}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select type..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cleaning">Cleaning</SelectItem>
                    <SelectItem value="maintenance">Maintenance</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel>Description</FieldLabel>
                <Textarea
                  placeholder="Brief description of this template (optional)"
                  rows={2}
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  disabled={isSaving}
                />
              </Field>
          </div>

          <FieldSeparator />

          {/* ============================================================
              Form Fields
              ============================================================ */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <FieldTitle className="text-lg">Form Fields</FieldTitle>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" type="button" disabled={isSaving}>
                    + Add Field
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  {FIELD_TYPE_OPTIONS.map((option) => (
                    <DropdownMenuItem
                      key={option.value}
                      onClick={() => addField(option.value)}
                    >
                      {option.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {fields.length === 0 ? (
              <div className="text-center py-12 border-2 border-dashed border-neutral-300 dark:border-neutral-600 rounded-lg">
                <p className="text-sm text-muted-foreground">
                  No fields yet. Click &quot;Add Field&quot; to get started.
                </p>
              </div>
            ) : (
              <>
              <div className="flex flex-col gap-4">
                {fields.map((field, index) => (
                  <div
                    key={field.id}
                    className={`rounded-lg border p-4 ${
                      field.type === 'separator'
                        ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/20'
                        : 'border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Reorder controls */}
                      <div className="flex flex-col gap-0.5 pt-0.5 shrink-0">
                        <button
                          onClick={() => moveFieldUp(index)}
                          disabled={index === 0 || isSaving}
                          type="button"
                          className="p-1 rounded text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          title="Move up"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                          </svg>
                        </button>
                        <button
                          onClick={() => moveFieldDown(index)}
                          disabled={index === fields.length - 1 || isSaving}
                          type="button"
                          className="p-1 rounded text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          title="Move down"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                      </div>

                      {/* Field content */}
                      <div className="flex-1 min-w-0 space-y-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="secondary" className="text-xs">
                            {FIELD_TYPE_OPTIONS.find((o) => o.value === field.type)?.label || field.type}
                          </Badge>
                          {field.type !== 'separator' && (
                            <label className="flex items-center gap-1.5 ml-auto cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={field.required}
                                onChange={(e) =>
                                  updateField(index, { required: e.target.checked })
                                }
                                className="w-3.5 h-3.5 rounded border-neutral-300"
                                disabled={isSaving}
                              />
                              <span className="text-xs text-muted-foreground">Required</span>
                            </label>
                          )}
                        </div>
                        <Input
                          value={field.label}
                          onChange={(e) => updateField(index, { label: e.target.value })}
                          placeholder={
                            field.type === 'separator'
                              ? 'Enter section title'
                              : 'Enter field label'
                          }
                          disabled={isSaving}
                        />
                      </div>

                      {/* Remove button */}
                      <button
                        onClick={() => removeField(index)}
                        type="button"
                        disabled={isSaving}
                        className="p-1.5 rounded shrink-0 text-neutral-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        title="Remove field"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Bottom add-field button */}
              <div className="flex justify-center pt-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      type="button"
                      disabled={isSaving}
                      className="rounded-full w-8 h-8 p-0"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-48">
                    {FIELD_TYPE_OPTIONS.map((option) => (
                      <DropdownMenuItem
                        key={option.value}
                        onClick={() => addField(option.value)}
                      >
                        {option.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              </>
            )}
          </div>

          {/* ============================================================
              Delete Zone — only for existing templates
              ============================================================ */}
          {isEditing && (
            <>
              <FieldSeparator />
              <button
                type="button"
                onClick={deleteTemplate}
                className="flex items-center gap-2 text-sm text-neutral-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Delete this template
              </button>
            </>
          )}
        </form>
      </div>

      {/* Bottom bar */}
      <div className="w-full border-t border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 flex-shrink-0 flex justify-center">
        <div
          style={{ width: '100%', maxWidth: '48rem' }}
          className="px-8 py-4 flex items-center justify-between"
        >
          <button
            onClick={() => router.push('/templates')}
            className="flex items-center gap-2 text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-white transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Templates
          </button>
          <Button size="sm" onClick={saveTemplate} disabled={isSaving}>
            {isSaving ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Template'}
          </Button>
        </div>
      </div>
    </div>
  );
}
