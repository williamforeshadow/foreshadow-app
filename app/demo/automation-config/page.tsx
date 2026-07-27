'use client';

// Demo fixtures for the automation config form. Public (/demo is auth-exempt)
// so the form is browser-verifiable without a session — same reason
// /demo/task-detail exists. Nothing here writes: state is local only.

import { useState } from 'react';
import AutomationConfigForm from '@/components/templates/AutomationConfigForm';
import {
  createDefaultAutomationConfig,
  type AutomationConfig,
  type AutomationPreset,
  type AutomationTriggerType,
  type User,
} from '@/lib/types';

const DEMO_USERS = [
  { id: 'u1', name: 'Billy Hale', role: 'admin' },
  { id: 'u2', name: 'Gabe Kim', role: 'housekeeper' },
  { id: 'u3', name: 'Ana Ruiz', role: 'maintenance' },
] as unknown as User[];

const DEMO_PRESETS = [
  {
    id: 'p1',
    name: 'Standard Turnover Cleaning',
    trigger_type: 'turnover',
    config: {
      schedule: createDefaultAutomationConfig().schedule,
      same_day_override: createDefaultAutomationConfig().same_day_override,
      auto_assign: createDefaultAutomationConfig().auto_assign,
    },
  },
] as unknown as AutomationPreset[];

const TRIGGERS: AutomationTriggerType[] = ['turnover', 'occupancy', 'vacancy', 'recurring'];

export default function AutomationConfigDemoPage() {
  const [config, setConfig] = useState<AutomationConfig>(() => ({
    ...createDefaultAutomationConfig(),
    enabled: true,
  }));
  const [isNew, setIsNew] = useState(false);

  return (
    <div className="panel-form flex h-screen flex-col" style={{ background: 'var(--task-surface-0)' }}>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b p-3" style={{ borderColor: 'var(--task-line-soft)' }}>
        {TRIGGERS.map((t) => (
          <button
            key={t}
            onClick={() => setConfig((c) => ({ ...c, trigger_type: t }))}
            className="rounded-full border px-3 py-1 text-xs font-medium"
            style={{
              borderColor: config.trigger_type === t ? 'transparent' : 'var(--task-line)',
              background: config.trigger_type === t ? 'var(--task-accent)' : 'transparent',
              color: config.trigger_type === t ? '#fff' : 'var(--task-ink-3)',
            }}
          >
            {t}
          </button>
        ))}
        <button
          onClick={() => setIsNew((v) => !v)}
          className="rounded-full border px-3 py-1 text-xs font-medium"
          style={{ borderColor: 'var(--task-line)', color: 'var(--task-ink-3)' }}
        >
          isNew: {String(isNew)}
        </button>
        <span className="ml-auto text-[11px]" style={{ color: 'var(--task-ink-3)' }}>
          demo mode — local state only
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[46rem] pb-6">
          <AutomationConfigForm
            config={config}
            onChange={setConfig}
            users={DEMO_USERS}
            presets={DEMO_PRESETS}
            isNew={isNew}
            onSavePreset={() => {}}
          />
        </div>
      </div>
    </div>
  );
}
