'use client';

import { useState, useEffect } from 'react';
import { AdaptivePicker } from '@/components/tasks/detail/primitives/AdaptivePicker';
import { TaskOptionRow } from '@/components/tasks/detail/primitives/TaskSheet';
import {
  ChipButton,
  FieldRow,
  InlineEditText,
  MetaChip,
  RowIconButton,
  SectionLabel,
  ToggleSwitch,
} from '@/components/ui/panel/PanelForm';
import type { FieldOverrides, FieldOverrideEntry, FieldModification } from '@/lib/types';
import {
  FieldTypeGlyph,
  FIELD_TYPE_OPTIONS,
  fieldTypeShortLabel,
  type FieldType,
} from './FieldTypeGlyph';

// ============================================================================
// Types
// ============================================================================

export interface BaseField {
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

const ICONS = {
  plus: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  reset: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12a8 8 0 1 0 2.5-5.8" /><path d="M4 4v4h4" />
    </svg>
  ),
  trash: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M6 7l.9 12.1A2 2 0 008.9 21h6.2a2 2 0 002-1.9L18 7" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  ),
};

const ROW_CLASS = 'flex items-center gap-2.5 border-b px-[18px] py-2.5';

// ============================================================================
// One property-specific field (own picker state, so it lives in its own row)
// ============================================================================

function AdditionalFieldRow({
  field,
  index,
  onUpdate,
  onRemove,
}: {
  field: FieldOverrideEntry;
  index: number;
  onUpdate: (index: number, updates: Partial<FieldOverrideEntry>) => void;
  onRemove: (index: number) => void;
}) {
  const [typeOpen, setTypeOpen] = useState(false);

  return (
    <div className={ROW_CLASS} style={{ borderColor: 'var(--task-line-soft)' }}>
      <span className="shrink-0" style={{ color: 'var(--task-ink-3)' }}>
        <FieldTypeGlyph type={field.type as FieldType} />
      </span>

      <div className="min-w-0 flex-1">
        <InlineEditText
          value={field.label}
          placeholder="Field label"
          ariaLabel={`Rename ${field.label || 'field'}`}
          onChange={(next) => onUpdate(index, { label: next })}
        />
      </div>

      <AdaptivePicker
        open={typeOpen}
        onOpenChange={setTypeOpen}
        title="Field type"
        align="end"
        trigger={
          <ChipButton set aria-label="Field type">
            {fieldTypeShortLabel(field.type as FieldType)}
          </ChipButton>
        }
      >
        {FIELD_TYPE_OPTIONS.map((opt) => (
          <TaskOptionRow
            key={opt.value}
            selected={opt.value === field.type}
            onSelect={() => {
              onUpdate(index, { type: opt.value });
              setTypeOpen(false);
            }}
            leading={<FieldTypeGlyph type={opt.value} size={16} />}
          >
            {opt.label}
          </TaskOptionRow>
        ))}
      </AdaptivePicker>

      {field.type !== 'separator' && (
        <ChipButton
          set={field.required}
          onClick={() => onUpdate(index, { required: !field.required })}
          aria-label={field.required ? 'Required' : 'Optional'}
        >
          {field.required ? 'Required' : 'Optional'}
        </ChipButton>
      )}

      <RowIconButton danger label="Delete field" onClick={() => onRemove(index)}>
        {ICONS.trash}
      </RowIconButton>
    </div>
  );
}

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
  const [addOpen, setAddOpen] = useState(false);

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

  const summary = [
    removedIds.size > 0 ? `${removedIds.size} hidden` : null,
    Object.keys(modifications).length > 0 ? `${Object.keys(modifications).length} edited` : null,
    additionalFields.length > 0 ? `${additionalFields.length} added` : null,
  ].filter(Boolean);

  return (
    <>
      {/* ── Base Template Fields ── */}
      <SectionLabel>Base template fields</SectionLabel>
      <div
        className="px-[18px] pb-2 text-[length:var(--task-fs-body-sm)]"
        style={{ color: 'var(--task-ink-3)' }}
      >
        Toggle fields off to hide them for this property, or click the label to rename it.
      </div>

      {baseFields.map((field) => {
        const isRemoved = removedIds.has(field.id);
        const mod = modifications[field.id];
        const displayLabel = mod?.label ?? field.label;
        const isModified = !!mod;

        return (
          <div key={field.id} className={ROW_CLASS} style={{ borderColor: 'var(--task-line-soft)' }}>
            <span className="shrink-0" style={{ color: 'var(--task-ink-3)' }}>
              <FieldTypeGlyph type={field.type} />
            </span>

            {/* Field label — struck through when hidden, renameable otherwise */}
            <div className="min-w-0 flex-1">
              {isRemoved ? (
                <span
                  className="block truncate px-1 py-0.5 text-[length:var(--task-fs-option)] line-through"
                  style={{ color: 'var(--task-ink-3)' }}
                >
                  {field.label}
                </span>
              ) : (
                <InlineEditText
                  value={displayLabel}
                  placeholder={field.label}
                  ariaLabel={`Rename ${field.label}`}
                  onChange={(next) => updateModification(field.id, 'label', next)}
                />
              )}
            </div>

            {isModified && !isRemoved && (
              <>
                <MetaChip tone="accent">Edited</MetaChip>
                <RowIconButton
                  label="Reset to base template value"
                  onClick={() => clearModification(field.id)}
                >
                  {ICONS.reset}
                </RowIconButton>
              </>
            )}

            {/* The leading glyph already carries the type, so the label chip
                yields its width to long field names on narrow screens. */}
            <MetaChip className="hidden sm:flex">{fieldTypeShortLabel(field.type)}</MetaChip>

            <ToggleSwitch
              checked={!isRemoved}
              onChange={() => toggleRemoveField(field.id)}
              label={isRemoved ? 'Re-enable this field' : 'Hide this field for this property'}
            />
          </div>
        );
      })}

      {/* ── Additional Fields (property-specific) ── */}
      <SectionLabel>Additional fields</SectionLabel>

      {additionalFields.map((field, index) => (
        <AdditionalFieldRow
          key={field.id}
          field={field}
          index={index}
          onUpdate={updateAdditionalField}
          onRemove={removeAdditionalField}
        />
      ))}

      <AdaptivePicker
        open={addOpen}
        onOpenChange={setAddOpen}
        title="Add field"
        trigger={
          <FieldRow icon={ICONS.plus} placeholder="Add a property-specific field" chevron={false} />
        }
      >
        {FIELD_TYPE_OPTIONS.map((opt) => (
          <TaskOptionRow
            key={opt.value}
            onSelect={() => {
              addField(opt.value);
              setAddOpen(false);
            }}
            leading={<FieldTypeGlyph type={opt.value} size={16} />}
          >
            {opt.label}
          </TaskOptionRow>
        ))}
      </AdaptivePicker>

      {/* Summary */}
      {hasAnyOverrides && (
        <div
          className="px-[18px] py-3 font-mono text-[length:var(--task-fs-label)] uppercase tracking-[0.14em]"
          style={{ color: 'var(--task-ink-3)' }}
        >
          {summary.join(' · ')}
        </div>
      )}
    </>
  );
}
