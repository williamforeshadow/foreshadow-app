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
  type PropertyTemplateAssignment,
  type User,
  createDefaultAutomationConfig,
} from '@/lib/types';
import AutomationConfigForm from './AutomationConfigForm';

interface AutomationConfigEditorProps {
  propertyName: string;
  templateId: string;
}

export default function AutomationConfigEditor({
  propertyName,
  templateId,
}: AutomationConfigEditorProps) {
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
  }, [propertyName, templateId]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [assignmentsRes, usersRes, presetsRes, templateRes] = await Promise.all([
        fetch('/api/property-templates'),
        fetch('/api/users'),
        fetch('/api/automation-presets'),
        fetch(`/api/templates/${templateId}`),
      ]);

      const [assignmentsData, usersData, presetsData, templateData] = await Promise.all([
        assignmentsRes.json(),
        usersRes.json(),
        presetsRes.json(),
        templateRes.json(),
      ]);

      if (usersData.data) setUsers(usersData.data);
      if (presetsData.presets) setPresets(presetsData.presets);
      setTemplateName(templateData.template?.name || 'Unknown Template');

      // Find the assignment for this property + template
      const assignment = ((assignmentsData.assignments ?? []) as PropertyTemplateAssignment[]).find(
        (a) => a.property_name === propertyName && a.template_id === templateId
      );

      if (assignment) {
        const defaults = createDefaultAutomationConfig();
        const saved = assignment.automation_config;

        // Deep merge with defaults to ensure all nested fields exist
        const config: AutomationConfig = saved ? {
          enabled: saved.enabled ?? defaults.enabled,
          trigger_type: saved.trigger_type ?? defaults.trigger_type,
          schedule: {
            enabled: saved.schedule?.enabled ?? defaults.schedule.enabled,
            type: saved.schedule?.type ?? defaults.schedule.type,
            relative_to: saved.schedule?.relative_to ?? defaults.schedule.relative_to,
            days_offset: saved.schedule?.days_offset ?? defaults.schedule.days_offset,
            time: saved.schedule?.time ?? defaults.schedule.time,
          },
          same_day_override: {
            enabled: saved.same_day_override?.enabled ?? defaults.same_day_override.enabled,
            schedule: {
              type: saved.same_day_override?.schedule?.type ?? defaults.same_day_override.schedule.type,
              relative_to: saved.same_day_override?.schedule?.relative_to ?? defaults.same_day_override.schedule.relative_to,
              days_offset: saved.same_day_override?.schedule?.days_offset ?? defaults.same_day_override.schedule.days_offset,
              time: saved.same_day_override?.schedule?.time ?? defaults.same_day_override.schedule.time,
            },
          },
          auto_assign: {
            enabled: saved.auto_assign?.enabled ?? defaults.auto_assign.enabled,
            user_ids: saved.auto_assign?.user_ids ?? defaults.auto_assign.user_ids,
          },
          occupancy_condition: {
            operator: saved.occupancy_condition?.operator ?? defaults.occupancy_condition!.operator,
            days: saved.occupancy_condition?.days ?? defaults.occupancy_condition!.days,
            days_end: saved.occupancy_condition?.days_end,
          },
          occupancy_schedule: {
            enabled: saved.occupancy_schedule?.enabled ?? defaults.occupancy_schedule!.enabled,
            day_of_occupancy: saved.occupancy_schedule?.day_of_occupancy ?? defaults.occupancy_schedule!.day_of_occupancy,
            time: saved.occupancy_schedule?.time ?? defaults.occupancy_schedule!.time,
            repeat: {
              enabled: saved.occupancy_schedule?.repeat?.enabled ?? defaults.occupancy_schedule!.repeat.enabled,
              interval_days: saved.occupancy_schedule?.repeat?.interval_days ?? defaults.occupancy_schedule!.repeat.interval_days,
            },
          },
          vacancy_condition: {
            operator: saved.vacancy_condition?.operator ?? defaults.vacancy_condition!.operator,
            days: saved.vacancy_condition?.days ?? defaults.vacancy_condition!.days,
            days_end: saved.vacancy_condition?.days_end,
          },
          vacancy_schedule: {
            enabled: saved.vacancy_schedule?.enabled ?? defaults.vacancy_schedule!.enabled,
            day_of_vacancy: saved.vacancy_schedule?.day_of_vacancy ?? defaults.vacancy_schedule!.day_of_vacancy,
            time: saved.vacancy_schedule?.time ?? defaults.vacancy_schedule!.time,
            repeat: {
              enabled: saved.vacancy_schedule?.repeat?.enabled ?? defaults.vacancy_schedule!.repeat.enabled,
              interval_days: saved.vacancy_schedule?.repeat?.interval_days ?? defaults.vacancy_schedule!.repeat.interval_days,
            },
            max_days_ahead: saved.vacancy_schedule?.max_days_ahead ?? defaults.vacancy_schedule!.max_days_ahead,
          },
          recurring_schedule: {
            start_date: saved.recurring_schedule?.start_date ?? defaults.recurring_schedule!.start_date,
            time: saved.recurring_schedule?.time ?? defaults.recurring_schedule!.time,
            interval_value: saved.recurring_schedule?.interval_value ?? defaults.recurring_schedule!.interval_value,
            interval_unit: saved.recurring_schedule?.interval_unit ?? defaults.recurring_schedule!.interval_unit,
          },
          contingent: {
            enabled: saved.contingent?.enabled ?? defaults.contingent!.enabled,
            auto_approve_enabled: saved.contingent?.auto_approve_enabled ?? defaults.contingent!.auto_approve_enabled,
            auto_approve_days: saved.contingent?.auto_approve_days ?? defaults.contingent!.auto_approve_days,
          },
          preset_id: saved.preset_id ?? null,
        } : defaults;

        setAutomationConfig(config);
      } else {
        setAutomationConfig(createDefaultAutomationConfig());
      }
    } catch (err) {
      console.error('Error fetching data:', err);
      setAutomationConfig(createDefaultAutomationConfig());
    } finally {
      setLoading(false);
    }
  };

  // Save existing automation config
  const saveAutomationConfig = async () => {
    if (!automationConfig) return;

    setSaving(true);
    try {
      const res = await fetch('/api/property-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_name: propertyName,
          template_id: templateId,
          enabled: true,
          automation_config: automationConfig,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        console.error('Save error details:', errData);
        throw new Error(errData.error || 'Failed to save automation config');
      }

      router.push('/automations');
    } catch (err) {
      console.error('Error saving automation config:', err);
      alert(err instanceof Error ? err.message : 'Failed to save automation configuration');
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
      {/* Header — close affordance, centred title, mono context micro-label. */}
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
              Configure Automation
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
          {automationConfig && (
            <AutomationConfigForm
              config={automationConfig}
              onChange={setAutomationConfig}
              users={users}
              presets={presets}
              isNew={false}
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
            onClick={() => router.push('/automations')}
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
            {saving ? 'Saving…' : 'Save Configuration'}
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
