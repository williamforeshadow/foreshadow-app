'use client';

import { useState, useEffect, useMemo } from 'react';
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
  const [activeSectionKey, setActiveSectionKey] = useState<string | null>(null);

  // Auto-select first department if none selected and creating new template
  useEffect(() => {
    if (!departmentId && !isEditing && departments.length > 0) {
      setDepartmentId(departments[0].id);
    }
  }, [departments, departmentId, isEditing]);

  // ---- sections ------------------------------------------------------------
  // Separators in the flat fields array carve it into sections — the same
  // model the checklist renders as swipeable tabs. The editor mirrors that:
  // a section strip, and the field list shows only the active section.
  // Storage stays the flat array, so nothing downstream changes.
  interface EditorSection {
    key: string;
    label: string;
    /** Flat index of the separator field (-1 for the implicit lead section). */
    sepIndex: number;
    /** Flat index range [start, end) of the section's fields. */
    start: number;
    end: number;
  }

  const sections = useMemo<EditorSection[]>(() => {
    const list: EditorSection[] = [];
    let current: EditorSection = { key: '__lead', label: 'General', sepIndex: -1, start: 0, end: 0 };
    fields.forEach((f, i) => {
      if (f.type === 'separator') {
        current.end = i;
        list.push(current);
        current = { key: f.id, label: f.label, sepIndex: i, start: i + 1, end: i + 1 };
      }
    });
    current.end = fields.length;
    list.push(current);
    return list;
  }, [fields]);

  const activeSection =
    sections.find((s) => s.key === activeSectionKey) ?? sections[0];

  const addField = (type: FieldType) => {
    const newField: FieldDefinition = {
      id: `field_${Date.now()}`,
      type,
      label: '',
      required: false,
    };
    // New fields land at the end of the active section.
    const newFields = [...fields];
    newFields.splice(activeSection.end, 0, newField);
    setFields(newFields);
  };

  const addSection = () => {
    const sep: FieldDefinition = {
      id: `sep_${Date.now()}`,
      type: 'separator',
      label: '',
      required: false,
    };
    setFields([...fields, sep]);
    setActiveSectionKey(sep.id);
  };

  const removeSection = () => {
    if (activeSection.sepIndex < 0) return;
    // Fields merge into the previous section; focus follows them.
    const idx = sections.findIndex((s) => s.key === activeSection.key);
    const prevKey = sections[idx - 1]?.key ?? '__lead';
    setFields(fields.filter((_, i) => i !== activeSection.sepIndex));
    setActiveSectionKey(prevKey);
  };

  const updateField = (index: number, updates: Partial<FieldDefinition>) => {
    const newFields = [...fields];
    newFields[index] = { ...newFields[index], ...updates };
    setFields(newFields);
  };

  const removeField = (index: number) => {
    setFields(fields.filter((_, i) => i !== index));
  };

  // Reorder within the active section only — crossing a separator would
  // silently move the field to another section.
  const moveFieldUp = (index: number) => {
    if (index - 1 <= activeSection.sepIndex) return;
    const newFields = [...fields];
    [newFields[index - 1], newFields[index]] = [newFields[index], newFields[index - 1]];
    setFields(newFields);
  };

  const moveFieldDown = (index: number) => {
    if (index + 1 >= activeSection.end) return;
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

    // Say what deleting actually does: pending untouched tasks are removed;
    // anything worked on or finished keeps its checklist (snapshot).
    let message = 'Delete this template? This cannot be undone.';
    try {
      const res = await fetch(`/api/templates/${templateId}/usage`);
      if (res.ok) {
        const usage = (await res.json()) as { pending_removed: number; kept: number };
        const parts = ['Delete this template?'];
        if (usage.pending_removed > 0) {
          parts.push(
            `${usage.pending_removed} upcoming task${usage.pending_removed === 1 ? '' : 's'} will be removed.`
          );
        }
        if (usage.kept > 0) {
          parts.push(
            `${usage.kept} task${usage.kept === 1 ? '' : 's'} with work on ${usage.kept === 1 ? 'it' : 'them'} will keep ${usage.kept === 1 ? 'its' : 'their'} checklist.`
          );
        }
        parts.push('This cannot be undone.');
        message = parts.join(' ');
      }
    } catch {
      /* fall back to the generic message */
    }
    if (!confirm(message)) return;

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
              {(() => {
                const n = fields.filter((f) => f.type !== 'separator').length;
                return `${n} field${n === 1 ? '' : 's'}`;
              })()}
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

          {/* Section strip — mirrors the checklist's tabs, plus "+ Section".
              The list below shows only the active section's fields, so the
              editor renders the way the checklist fills. */}
          <div
            className="flex gap-1.5 overflow-x-auto border-b px-[18px] pb-3 pt-1"
            style={{ borderColor: 'var(--task-line-soft)', scrollbarWidth: 'none' }}
          >
            {sections.map((s) => {
              const isActive = s.key === activeSection.key;
              const count = s.end - s.start;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setActiveSectionKey(s.key)}
                  className="flex h-[var(--task-ctl-h)] shrink-0 items-center gap-1.5 rounded-lg px-[11px] font-mono text-[length:var(--task-fs-chip)] uppercase tracking-[0.08em] transition-transform active:scale-95"
                  style={{
                    background: isActive ? 'var(--task-surface-2)' : 'transparent',
                    border: `1px solid ${isActive ? 'var(--task-line)' : 'transparent'}`,
                    color: isActive ? 'var(--task-ink-1)' : 'var(--task-ink-3)',
                  }}
                >
                  <span className="max-w-[10rem] truncate normal-case">
                    {s.label || (s.sepIndex < 0 ? 'General' : 'Untitled')}
                  </span>
                  <span style={{ color: 'var(--task-ink-3)' }}>{count}</span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={addSection}
              disabled={isSaving}
              className="flex h-[var(--task-ctl-h)] shrink-0 items-center gap-1 rounded-lg px-[11px] font-mono text-[length:var(--task-fs-chip)] uppercase tracking-[0.08em] transition-transform active:scale-95"
              style={{
                border: '1px dashed var(--task-line)',
                color: 'var(--task-ink-3)',
              }}
            >
              + Section
            </button>
          </div>

          {/* Named sections: editable title + delete (fields merge left). */}
          {activeSection.sepIndex >= 0 && (
            <div
              className="flex items-center gap-2.5 border-b px-[18px] py-2"
              style={{ borderColor: 'var(--task-line-soft)' }}
            >
              <span className="shrink-0" style={{ color: 'var(--task-ink-3)' }}>
                <FieldTypeGlyph type="separator" />
              </span>
              <div className="min-w-0 flex-1">
                <InlineEditText
                  value={activeSection.label}
                  placeholder="Section title"
                  ariaLabel="Rename section"
                  onChange={(next) => updateField(activeSection.sepIndex, { label: next })}
                />
              </div>
              <RowIconButton
                danger
                label="Remove section (fields move to the previous section)"
                onClick={removeSection}
              >
                {ICONS.trash}
              </RowIconButton>
            </div>
          )}

          {activeSection.end - activeSection.start === 0 ? (
            <div className="px-[18px] py-10 text-center">
              <p className="text-[length:var(--task-fs-option)]" style={{ color: 'var(--task-ink-2)' }}>
                {sections.length > 1 ? 'No fields in this section yet.' : 'No fields yet.'}
              </p>
              <p className="mt-1.5 text-[length:var(--task-fs-body-sm)]" style={{ color: 'var(--task-ink-3)' }}>
                Fields are the checklist a generated task presents.
              </p>
            </div>
          ) : (
            fields.slice(activeSection.start, activeSection.end).map((field, i) => {
              const index = activeSection.start + i;
              return (
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
                      placeholder="Field label"
                      ariaLabel={`Rename ${field.label || 'field'}`}
                      onChange={(next) => updateField(index, { label: next })}
                    />
                  </div>

                  {/* Type is fixed once added, so it reads rather than picks. */}
                  <MetaChip>{fieldTypeShortLabel(field.type)}</MetaChip>

                  <ChipButton
                    set={field.required}
                    disabled={isSaving}
                    onClick={() => updateField(index, { required: !field.required })}
                    aria-label={field.required ? 'Required' : 'Optional'}
                  >
                    {field.required ? 'Required' : 'Optional'}
                  </ChipButton>

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
              );
            })
          )}

          {/* One add control, at the end of the list; new fields land in the
              active section. Sections are added from the strip, so the
              separator "type" is no longer offered here. */}
          <AdaptivePicker
            open={addOpen}
            onOpenChange={setAddOpen}
            title="Add field"
            disabled={isSaving}
            trigger={<FieldRow icon={ICONS.plus} placeholder="Add a field" chevron={false} />}
          >
            {FIELD_TYPE_OPTIONS.filter((o) => o.value !== 'separator').map((option) => (
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
