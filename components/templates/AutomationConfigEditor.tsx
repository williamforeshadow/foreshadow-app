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
      const assignment = (assignmentsData.assignments || []).find(
        (a: any) => a.property_name === propertyName && a.template_id === templateId
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

      router.push('/templates');
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
            {propertyName} — {templateName}
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
            isNew={false}
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
            {saving ? 'Saving...' : 'Save Configuration'}
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
