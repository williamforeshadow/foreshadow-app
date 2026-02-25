'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import {
  type AutomationConfig,
  type AutomationPreset,
  type User,
  createDefaultAutomationConfig,
} from '@/lib/types';
import AutomationConfigForm from './AutomationConfigForm';

interface BulkAutomationConfigEditorProps {
  propertyNames: string[];
  templateId: string;
}

export default function BulkAutomationConfigEditor({
  propertyNames,
  templateId,
}: BulkAutomationConfigEditorProps) {
  const router = useRouter();

  const [templateName, setTemplateName] = useState<string>('');
  const [automationConfig, setAutomationConfig] = useState<AutomationConfig | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [presets, setPresets] = useState<AutomationPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Preset dialog state
  const [showPresetDialog, setShowPresetDialog] = useState(false);
  const [presetName, setPresetName] = useState('');

  useEffect(() => {
    fetchData();
  }, [templateId]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [usersRes, presetsRes, templateRes] = await Promise.all([
        fetch('/api/users'),
        fetch('/api/automation-presets'),
        fetch(`/api/templates/${templateId}`),
      ]);

      const [usersData, presetsData, templateData] = await Promise.all([
        usersRes.json(),
        presetsRes.json(),
        templateRes.json(),
      ]);

      if (usersData.data) setUsers(usersData.data);
      if (presetsData.presets) setPresets(presetsData.presets);
      setTemplateName(templateData.template?.name || 'Unknown Template');

      // Start with default config for bulk
      setAutomationConfig(createDefaultAutomationConfig());
    } catch (err) {
      console.error('Error fetching data:', err);
      setAutomationConfig(createDefaultAutomationConfig());
    } finally {
      setLoading(false);
    }
  };

  // Save automation config to all selected properties
  const saveAutomationConfig = async () => {
    if (!automationConfig) return;

    setSaving(true);
    try {
      const promises = propertyNames.map(propertyName =>
        fetch('/api/property-templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            property_name: propertyName,
            template_id: templateId,
            enabled: true,
            automation_config: automationConfig,
          }),
        })
      );

      const results = await Promise.all(promises);
      const failed = results.filter(r => !r.ok).length;

      if (failed > 0) {
        alert(`Applied to ${propertyNames.length - failed} properties. ${failed} failed.`);
      }

      router.push('/templates');
    } catch (err) {
      console.error('Error saving bulk automation config:', err);
      alert('Failed to save automation configuration for some properties');
    } finally {
      setSaving(false);
    }
  };

  // Save as preset
  const saveAsPreset = async () => {
    if (!automationConfig || !presetName.trim()) return;

    setSaving(true);
    try {
      const res = await fetch('/api/automation-presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: presetName,
          trigger_type: automationConfig.trigger_type,
          config: {
            schedule: automationConfig.schedule,
            same_day_override: automationConfig.same_day_override,
            auto_assign: automationConfig.auto_assign,
          },
        }),
      });

      if (!res.ok) throw new Error('Failed to save preset');

      const data = await res.json();
      setPresets([data.preset, ...presets]);
      setShowPresetDialog(false);
      setPresetName('');
      setAutomationConfig({ ...automationConfig, preset_id: data.preset.id });
    } catch (err) {
      console.error('Error saving preset:', err);
      alert('Failed to save preset');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="h-screen bg-neutral-50 dark:bg-neutral-950 flex items-center justify-center">
        <p className="text-neutral-500">Loading automation configuration...</p>
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
        <div className="pb-4">
          <h1 className="text-2xl font-semibold text-neutral-900 dark:text-white">
            Configure Automation
          </h1>
        </div>
        <div className="pb-2">
          <p className="text-base text-neutral-500">
            {templateName} — {propertyNames.length} properties
          </p>
        </div>

        {/* Properties summary */}
        <div className="p-3 bg-neutral-50 dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 mb-2">
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            {propertyNames.join(', ')}
          </p>
        </div>

        <hr className="border-neutral-200 dark:border-neutral-800 my-6" />

        <div className="pt-4" />

        {automationConfig && (
          <AutomationConfigForm
            config={automationConfig}
            onChange={setAutomationConfig}
            users={users}
            presets={presets}
            isNew={true}
            onSavePreset={() => setShowPresetDialog(true)}
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
          <Button size="sm" onClick={saveAutomationConfig} disabled={saving}>
            {saving ? 'Saving...' : `Apply to ${propertyNames.length} Properties`}
          </Button>
        </div>
      </div>

      {/* Save Preset Dialog */}
      <Dialog open={showPresetDialog} onOpenChange={setShowPresetDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Save Automation Preset</DialogTitle>
            <DialogDescription>
              Save this configuration as a reusable preset.
            </DialogDescription>
          </DialogHeader>

          <Field>
            <FieldLabel>Preset Name</FieldLabel>
            <Input
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="e.g., Standard Turnover Cleaning"
            />
          </Field>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPresetDialog(false)}>
              Cancel
            </Button>
            <Button onClick={saveAsPreset} disabled={saving || !presetName.trim()}>
              {saving ? 'Saving...' : 'Save Preset'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
