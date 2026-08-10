'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AdaptivePicker } from '@/components/tasks/detail/primitives/AdaptivePicker';
import { TaskOptionRow } from '@/components/tasks/detail/primitives/TaskSheet';
import {
  ChipButton,
  ERROR_TONE,
  FieldRow,
  InlineEditText,
  MetaChip,
  RowIconButton,
  SectionLabel,
  ToggleRow,
} from '@/components/ui/panel/PanelForm';
import InfoTooltip from './InfoTooltip';
import { DeptGlyph } from '@/components/tasks/DeptGlyph';
import {
  FieldTypeGlyph,
  FIELD_TYPE_OPTIONS,
  fieldTypeShortLabel,
  type FieldType,
} from './FieldTypeGlyph';
import { useDepartments } from '@/lib/departmentsContext';

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

const ICONS = {
  back: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  ),
  text: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7V5h16v2M9 5v14M15 19H9" />
    </svg>
  ),
  plus: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  up: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 15l6-6 6 6" />
    </svg>
  ),
  down: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9l6 6 6-6" />
    </svg>
  ),
  trash: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M6 7l.9 12.1A2 2 0 008.9 21h6.2a2 2 0 002-1.9L18 7" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  ),
};

interface TemplateEditorProps {
  /** null = creating new template */
  templateId: string | null;
  initialName?: string;
  initialDepartmentId?: string | null;
  initialDescription?: string;
  initialFields?: FieldDefinition[];
  initialInformsReadiness?: boolean;
}

export default function TemplateEditor({
  templateId,
  initialName = '',
  initialDepartmentId = null,
  initialDescription = '',
  initialFields = [],
  initialInformsReadiness = false,
}: TemplateEditorProps) {
  const router = useRouter();
  const isEditing = !!templateId;

  const [formName, setFormName] = useState(initialName);
  const [departmentId, setDepartmentId] = useState<string | null>(initialDepartmentId);
  const { departments, deptIconMap } = useDepartments();
  const [formDescription, setFormDescription] = useState(initialDescription);
  const [informsReadiness, setInformsReadiness] = useState(initialInformsReadiness);
  const [fields, setFields] = useState<FieldDefinition[]>(initialFields);
  const [formErrors, setFormErrors] = useState<{ name?: string }>({});
  const [isSaving, setIsSaving] = useState(false);
  const [deptOpen, setDeptOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  // Auto-select first department if none selected and creating new template
  useEffect(() => {
    if (!departmentId && !isEditing && departments.length > 0) {
      setDepartmentId(departments[0].id);
    }
  }, [departments, departmentId, isEditing]);

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
        department_id: departmentId,
        description: formDescription || null,
        fields,
        informs_readiness: informsReadiness,
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

  const selectedDept = departments.find((d) => d.id === departmentId) ?? null;

  return (
    <div className="panel-form flex h-screen flex-col items-center" style={{ background: 'var(--task-surface-0)' }}>
      {/* Header — matches the automation editors. */}
      <div className="w-full shrink-0 border-b" style={{ borderColor: 'var(--task-line-soft)' }}>
        <div className="mx-auto flex h-14 w-full max-w-[46rem] items-center justify-between gap-3 px-[18px]">
          <button
            type="button"
            onClick={() => router.push('/templates')}
            className="-ml-2 flex h-9 w-9 items-center justify-center rounded-lg transition-transform active:scale-95"
            style={{ color: 'var(--task-ink-2)' }}
            aria-label="Back to Templates"
          >
            {ICONS.back}
          </button>
          <div className="min-w-0 flex-1 text-center">
            <div className="truncate text-[length:var(--task-fs-option)] font-medium" style={{ color: 'var(--task-ink-1)' }}>
              {isEditing ? 'Edit Template' : 'New Template'}
            </div>
            <div
              className="truncate font-mono text-[length:var(--task-fs-label)] uppercase tracking-[0.14em]"
              style={{ color: 'var(--task-ink-3)' }}
            >
              {fields.length} field{fields.length === 1 ? '' : 's'}
            </div>
          </div>
          <div className="h-9 w-9" />
        </div>
      </div>

      {/* Scrollable content */}
      <form onSubmit={saveTemplate} className="w-full flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[46rem] pb-6">
          <SectionLabel>Template</SectionLabel>

          {/* Name — the only required field */}
          <div className="border-b" style={{ borderColor: 'var(--task-line-soft)' }}>
            <div className="flex items-center gap-3 px-[18px] py-3.5">
              <span
                className="shrink-0"
                style={{ color: formErrors.name ? ERROR_TONE : 'var(--task-ink-3)' }}
              >
                {ICONS.text}
              </span>
              <input
                value={formName}
                onChange={(e) => {
                  setFormName(e.target.value);
                  if (formErrors.name) setFormErrors({});
                }}
                placeholder="Template name (required)"
                disabled={isSaving}
                required
                className="min-w-0 flex-1 bg-transparent text-[length:var(--task-fs-option)] outline-none placeholder:text-[var(--task-ink-3)]"
                style={{ color: 'var(--task-ink-1)' }}
              />
            </div>
            {formErrors.name && (
              <div
                className="-mt-1 px-[18px] pb-2.5 text-[length:var(--task-fs-body-sm)]"
                style={{ color: ERROR_TONE }}
              >
                {formErrors.name}
              </div>
            )}
          </div>

          {/* Department */}
          <AdaptivePicker
            open={deptOpen}
            onOpenChange={setDeptOpen}
            title="Department"
            disabled={isSaving}
            trigger={
              <FieldRow
                icon={<DeptGlyph iconKey={selectedDept ? deptIconMap[selectedDept.id] : null} size={17} />}
                value={selectedDept?.name}
                placeholder="Select department…"
              />
            }
          >
            {departments.map((dept) => (
              <TaskOptionRow
                key={dept.id}
                selected={dept.id === departmentId}
                leading={<DeptGlyph iconKey={deptIconMap[dept.id]} size={17} />}
                onSelect={() => {
                  setDepartmentId(dept.id);
                  setDeptOpen(false);
                }}
              >
                {dept.name}
              </TaskOptionRow>
            ))}
          </AdaptivePicker>

          {/* Description */}
          <div className="border-b px-[18px] py-3" style={{ borderColor: 'var(--task-line-soft)' }}>
            <textarea
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              placeholder="Description (optional)"
              rows={2}
              disabled={isSaving}
              className="w-full resize-none bg-transparent text-[length:var(--task-fs-body)] outline-none placeholder:text-[var(--task-ink-3)]"
              style={{ color: 'var(--task-ink-1)' }}
            />
          </div>

          <ToggleRow
            label="Informs property readiness"
            hint={<InfoTooltip text="Tasks from this template scheduled between a check-out and the next check-in gate the property's readiness indicator on the Schedule" />}
            checked={informsReadiness}
            onChange={() => setInformsReadiness((v) => !v)}
            disabled={isSaving}
          />

          <SectionLabel>Fields</SectionLabel>

          {fields.length === 0 ? (
            <div className="px-[18px] py-10 text-center">
              <p className="text-[length:var(--task-fs-option)]" style={{ color: 'var(--task-ink-2)' }}>
                No fields yet.
              </p>
              <p className="mt-1.5 text-[length:var(--task-fs-body-sm)]" style={{ color: 'var(--task-ink-3)' }}>
                Fields are the checklist a generated task presents.
              </p>
            </div>
          ) : (
            fields.map((field, index) => (
              <div
                key={field.id}
                className="flex items-center gap-2.5 border-b px-[18px] py-2.5 transition-colors hover:bg-[var(--task-surface-1)]"
                style={{ borderColor: 'var(--task-line-soft)' }}
              >
                <span className="shrink-0" style={{ color: 'var(--task-ink-3)' }}>
                  <FieldTypeGlyph type={field.type} />
                </span>

                <div className="min-w-0 flex-1">
                  <InlineEditText
                    value={field.label}
                    placeholder={field.type === 'separator' ? 'Section title' : 'Field label'}
                    ariaLabel={`Rename ${field.label || 'field'}`}
                    onChange={(next) => updateField(index, { label: next })}
                  />
                </div>

                {/* Type is fixed once added, so it reads rather than picks. */}
                <MetaChip>{fieldTypeShortLabel(field.type)}</MetaChip>

                {field.type !== 'separator' && (
                  <ChipButton
                    set={field.required}
                    disabled={isSaving}
                    onClick={() => updateField(index, { required: !field.required })}
                    aria-label={field.required ? 'Required' : 'Optional'}
                  >
                    {field.required ? 'Required' : 'Optional'}
                  </ChipButton>
                )}

                <RowIconButton label="Move up" onClick={() => moveFieldUp(index)}>
                  {ICONS.up}
                </RowIconButton>
                <RowIconButton label="Move down" onClick={() => moveFieldDown(index)}>
                  {ICONS.down}
                </RowIconButton>
                <RowIconButton danger label="Remove field" onClick={() => removeField(index)}>
                  {ICONS.trash}
                </RowIconButton>
              </div>
            ))
          )}

          {/* One add control, at the end of the list — the old page had a
              duplicate button above and below the same list. */}
          <AdaptivePicker
            open={addOpen}
            onOpenChange={setAddOpen}
            title="Add field"
            disabled={isSaving}
            trigger={<FieldRow icon={ICONS.plus} placeholder="Add a field" chevron={false} />}
          >
            {FIELD_TYPE_OPTIONS.map((option) => (
              <TaskOptionRow
                key={option.value}
                leading={<FieldTypeGlyph type={option.value} size={16} />}
                onSelect={() => {
                  addField(option.value);
                  setAddOpen(false);
                }}
              >
                {option.label}
              </TaskOptionRow>
            ))}
          </AdaptivePicker>

          {/* Delete zone — only for existing templates */}
          {isEditing && (
            <>
              <SectionLabel>Danger zone</SectionLabel>
              <button
                type="button"
                onClick={deleteTemplate}
                className="flex w-full items-center gap-3 border-b px-[18px] py-3.5 text-left transition-colors hover:bg-[var(--task-surface-1)]"
                style={{ borderColor: 'var(--task-line-soft)', color: ERROR_TONE }}
              >
                <span className="shrink-0">{ICONS.trash}</span>
                <span className="text-[length:var(--task-fs-option)]">Delete this template</span>
              </button>
            </>
          )}
        </div>
      </form>

      {/* Action bar */}
      <div
        className="w-full shrink-0 border-t"
        style={{ borderColor: 'var(--task-line-soft)', background: 'var(--task-surface-1)' }}
      >
        <div className="mx-auto flex w-full max-w-[46rem] items-center gap-2 px-[18px] py-3">
          <button
            type="button"
            onClick={() => router.push('/templates')}
            className="h-[46px] shrink-0 rounded-xl border px-5 font-mono text-[length:var(--task-fs-cta)] uppercase tracking-[0.1em] transition-all active:scale-[0.98]"
            style={{ background: 'var(--task-surface-2)', borderColor: 'var(--task-line)', color: 'var(--task-ink-2)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={saveTemplate}
            disabled={isSaving}
            className="h-[46px] flex-1 rounded-xl font-mono text-[length:var(--task-fs-cta)] uppercase tracking-[0.1em] transition-all active:scale-[0.98] disabled:opacity-50"
            style={{ background: 'var(--task-accent)', color: '#fff' }}
          >
            {isSaving ? 'Saving…' : isEditing ? 'Save Changes' : 'Create Template'}
          </button>
        </div>
      </div>
    </div>
  );
}
