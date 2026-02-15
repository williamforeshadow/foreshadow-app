'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  type FieldOverrides,
  createDefaultFieldOverrides,
} from '@/lib/types';
import FieldOverridesEditor from './FieldOverridesEditor';

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
  const [baseTemplateFields, setBaseTemplateFields] = useState<any[]>([]);
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
      const assignment = (assignmentsData.assignments || []).find(
        (a: any) => a.property_name === propertyName && a.template_id === templateId
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

      router.push('/templates');
    } catch (err) {
      console.error('Error saving field overrides:', err);
      alert(err instanceof Error ? err.message : 'Failed to save template customizations');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="h-screen bg-neutral-50 dark:bg-neutral-950 flex items-center justify-center">
        <p className="text-neutral-500">Loading template fields...</p>
      </div>
    );
  }

  return (
    <div className="h-screen bg-neutral-50 dark:bg-neutral-950 flex flex-col items-center">
      {/* Scrollable content */}
      <div
        style={{ width: '100%', maxWidth: '48rem' }}
        className="px-8 py-10 flex-1 overflow-y-auto"
      >
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-white mb-2">
          Customize Template for this Property
        </h1>
        <p className="text-sm text-neutral-500 mb-2">
          {propertyName} → {templateName}
        </p>
        <p className="text-xs text-neutral-400 mb-10">
          Hide, rename, or add fields specific to this property. Changes here only affect this property — the base template stays the same for all other properties.
        </p>

        {loadingBaseFields ? (
          <div className="flex items-center justify-center py-8">
            <p className="text-neutral-500">Loading template fields...</p>
          </div>
        ) : baseTemplateFields.length === 0 ? (
          <div className="text-center py-12 border-2 border-dashed border-neutral-300 dark:border-neutral-600 rounded-lg">
            <p className="text-neutral-500">This template has no fields defined yet.</p>
            <p className="text-xs text-neutral-400 mt-1">Add fields to the base template first, then customize per-property here.</p>
          </div>
        ) : (
          <FieldOverridesEditor
            baseFields={baseTemplateFields}
            overrides={fieldOverrides}
            onChange={setFieldOverrides}
          />
        )}
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
            Back to Automations
          </button>
          <Button size="sm" onClick={saveFieldOverrides} disabled={saving}>
            {saving ? 'Saving...' : 'Save Customizations'}
          </Button>
        </div>
      </div>
    </div>
  );
}
