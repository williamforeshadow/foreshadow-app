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

      router.push('/automations/tasks');
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
      <div className="panel-form flex h-screen items-center justify-center" style={{ background: 'var(--task-surface-0)' }}>
        <p className="font-mono text-[length:var(--task-fs-label)] uppercase tracking-[0.14em]" style={{ color: 'var(--task-ink-3)' }}>
          Loading automation configuration…
        </p>
      </div>
    );
  }

  return (
    <div className="panel-form flex h-screen flex-col items-center" style={{ background: 'var(--task-surface-0)' }}>
      {/* Header — matches the single-property editor, with the property count
          as the context micro-label. */}
      <div className="w-full shrink-0 border-b" style={{ borderColor: 'var(--task-line-soft)' }}>
        <div className="mx-auto flex h-14 w-full max-w-[46rem] items-center justify-between gap-3 px-[18px]">
          <button
            type="button"
            onClick={() => router.push('/automations/tasks')}
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
              Configure Automation
            </div>
            <div
              className="truncate font-mono text-[length:var(--task-fs-label)] uppercase tracking-[0.14em]"
              style={{ color: 'var(--task-ink-3)' }}
            >
              {templateName} · {propertyNames.length} properties
            </div>
          </div>
          <div className="h-9 w-9" />
        </div>
      </div>

      {/* Scrollable content */}
      <div className="w-full flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[46rem] pb-6">
          {/* Which properties this will apply to. */}
          <div
            className="border-b px-[18px] py-3 text-[length:var(--task-fs-body-sm)]"
            style={{ borderColor: 'var(--task-line-soft)', color: 'var(--task-ink-3)' }}
          >
            {propertyNames.join(', ')}
          </div>

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
      </div>

      {/* Action bar */}
      <div
        className="w-full shrink-0 border-t"
        style={{ borderColor: 'var(--task-line-soft)', background: 'var(--task-surface-1)' }}
      >
        <div className="mx-auto flex w-full max-w-[46rem] items-center gap-2 px-[18px] py-3">
          <button
            type="button"
            onClick={() => router.push('/automations/tasks')}
            className="h-[46px] shrink-0 rounded-xl border px-5 font-mono text-[length:var(--task-fs-cta)] uppercase tracking-[0.1em] transition-all active:scale-[0.98]"
            style={{ background: 'var(--task-surface-2)', borderColor: 'var(--task-line)', color: 'var(--task-ink-2)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={saveAutomationConfig}
            disabled={saving}
            className="h-[46px] flex-1 rounded-xl font-mono text-[length:var(--task-fs-cta)] uppercase tracking-[0.1em] transition-all active:scale-[0.98] disabled:opacity-50"
            style={{ background: 'var(--task-accent)', color: '#fff' }}
          >
            {saving ? 'Saving…' : `Apply to ${propertyNames.length} Properties`}
          </button>
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
