'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  type FieldOverrides,
  type PropertyTemplateAssignment,
  createDefaultFieldOverrides,
} from '@/lib/types';
import FieldOverridesEditor, { type BaseField } from './FieldOverridesEditor';

interface PropertyFieldsEditorProps {
  propertyName: string;
  templateId: string;
}

export default function PropertyFieldsEditor({
  propertyName,
  templateId,
}: PropertyFieldsEditorProps) {
  const router = useRouter();

  const [templateName, setTemplateName] = useState<string>('');
  const [baseTemplateFields, setBaseTemplateFields] = useState<BaseField[]>([]);
  const [fieldOverrides, setFieldOverrides] = useState<FieldOverrides>(createDefaultFieldOverrides());
  const [loading, setLoading] = useState(true);
  const [loadingBaseFields, setLoadingBaseFields] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchData();
  }, [propertyName, templateId]);

  const fetchData = async () => {
    setLoading(true);
    setLoadingBaseFields(true);
    try {
      const [assignmentsRes, templateRes] = await Promise.all([
        fetch('/api/property-templates'),
        fetch(`/api/templates/${templateId}`),
      ]);

      const [assignmentsData, templateData] = await Promise.all([
        assignmentsRes.json(),
        templateRes.json(),
      ]);

      setTemplateName(templateData.template?.name || 'Unknown Template');
      setBaseTemplateFields(templateData.template?.fields ?? []);

      // Find the assignment for this property + template
      const assignment = ((assignmentsData.assignments ?? []) as PropertyTemplateAssignment[]).find(
        (a) => a.property_name === propertyName && a.template_id === templateId
      );

      if (assignment?.field_overrides) {
        setFieldOverrides(assignment.field_overrides);
      } else {
        setFieldOverrides(createDefaultFieldOverrides());
      }
    } catch (err) {
      console.error('Error fetching data:', err);
      setBaseTemplateFields([]);
    } finally {
      setLoading(false);
      setLoadingBaseFields(false);
    }
  };

  // Save field overrides
  const saveFieldOverrides = async () => {
    // Check if overrides are empty — save null to keep it clean
    const hasOverrides =
      fieldOverrides.additional_fields.length > 0 ||
      fieldOverrides.removed_field_ids.length > 0 ||
      Object.keys(fieldOverrides.modified_fields).length > 0;

    setSaving(true);
    try {
      const res = await fetch('/api/property-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_name: propertyName,
          template_id: templateId,
          enabled: true,
          field_overrides: hasOverrides ? fieldOverrides : null,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to save template customizations');
      }

      router.push('/automations');
    } catch (err) {
      console.error('Error saving field overrides:', err);
      alert(err instanceof Error ? err.message : 'Failed to save template customizations');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="panel-form flex h-screen items-center justify-center" style={{ background: 'var(--task-surface-0)' }}>
        <p className="font-mono text-[length:var(--task-fs-label)] uppercase tracking-[0.14em]" style={{ color: 'var(--task-ink-3)' }}>
          Loading template fields…
        </p>
      </div>
    );
  }

  return (
    <div className="panel-form flex h-screen flex-col items-center" style={{ background: 'var(--task-surface-0)' }}>
      {/* Header — matches the automation editors. */}
      <div className="w-full shrink-0 border-b" style={{ borderColor: 'var(--task-line-soft)' }}>
        <div className="mx-auto flex h-14 w-full max-w-[46rem] items-center justify-between gap-3 px-[18px]">
          <button
            type="button"
            onClick={() => router.push('/automations')}
            className="-ml-2 flex h-9 w-9 items-center justify-center rounded-lg transition-transform active:scale-95"
            style={{ color: 'var(--task-ink-2)' }}
            aria-label="Back to Automations"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
          <div className="min-w-0 flex-1 text-center">
            <div className="truncate text-[length:var(--task-fs-option)] font-medium" style={{ color: 'var(--task-ink-1)' }}>
              Customize Template
            </div>
            <div
              className="truncate font-mono text-[length:var(--task-fs-label)] uppercase tracking-[0.14em]"
              style={{ color: 'var(--task-ink-3)' }}
            >
              {propertyName} · {templateName}
            </div>
          </div>
          <div className="h-9 w-9" />
        </div>
      </div>

      {/* Scrollable content */}
      <div className="w-full flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[46rem] pb-6">
          <div
            className="border-b px-[18px] py-3 text-[length:var(--task-fs-body-sm)]"
            style={{ borderColor: 'var(--task-line-soft)', color: 'var(--task-ink-3)' }}
          >
            Hide, rename, or add fields specific to this property. Changes here only affect this property — the base template stays the same for all other properties.
          </div>

          {loadingBaseFields ? (
            <div className="px-[18px] py-8 text-center font-mono text-[length:var(--task-fs-label)] uppercase tracking-[0.14em]" style={{ color: 'var(--task-ink-3)' }}>
              Loading template fields…
            </div>
          ) : baseTemplateFields.length === 0 ? (
            <div className="px-[18px] py-10 text-center">
              <p className="text-[length:var(--task-fs-option)]" style={{ color: 'var(--task-ink-2)' }}>
                This template has no fields defined yet.
              </p>
              <p className="mt-1.5 text-[length:var(--task-fs-body-sm)]" style={{ color: 'var(--task-ink-3)' }}>
                Add fields to the base template first, then customize per-property here.
              </p>
            </div>
          ) : (
            <FieldOverridesEditor
              baseFields={baseTemplateFields}
              overrides={fieldOverrides}
              onChange={setFieldOverrides}
            />
          )}
        </div>
      </div>

      {/* Action bar */}
      <div
        className="w-full shrink-0 border-t"
        style={{ borderColor: 'var(--task-line-soft)', background: 'var(--task-surface-1)' }}
      >
        <div className="mx-auto flex w-full max-w-[46rem] items-center gap-2 px-[18px] py-3">
          <button
            type="button"
            onClick={() => router.push('/automations')}
            className="h-[46px] shrink-0 rounded-xl border px-5 font-mono text-[length:var(--task-fs-cta)] uppercase tracking-[0.1em] transition-all active:scale-[0.98]"
            style={{ background: 'var(--task-surface-2)', borderColor: 'var(--task-line)', color: 'var(--task-ink-2)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={saveFieldOverrides}
            disabled={saving}
            className="h-[46px] flex-1 rounded-xl font-mono text-[length:var(--task-fs-cta)] uppercase tracking-[0.1em] transition-all active:scale-[0.98] disabled:opacity-50"
            style={{ background: 'var(--task-accent)', color: '#fff' }}
          >
            {saving ? 'Saving…' : 'Save Customizations'}
          </button>
        </div>
      </div>
    </div>
  );
}
