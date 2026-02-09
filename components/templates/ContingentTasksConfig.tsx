'use client';

import { Input } from '@/components/ui/input';
import type { ContingentTasksConfig as ContingentConfig } from '@/lib/types';

// ============================================================================
// Reusable Toggle (matching AutomationConfigForm style)
// ============================================================================

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        checked ? 'bg-purple-600' : 'bg-neutral-300 dark:bg-neutral-600'
      }`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
        checked ? 'translate-x-6' : 'translate-x-1'
      }`} />
    </button>
  );
}

// ============================================================================
// Props
// ============================================================================

interface ContingentTasksConfigProps {
  config: ContingentConfig;
  onChange: (config: ContingentConfig) => void;
}

// ============================================================================
// Component
// ============================================================================

export default function ContingentTasksConfig({ config, onChange }: ContingentTasksConfigProps) {
  const update = (field: keyof ContingentConfig, value: unknown) => {
    onChange({ ...config, [field]: value });
  };

  return (
    <div className="border rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium text-sm">Generate as Contingent</div>
          <div className="text-xs text-neutral-500">
            Tasks are created as drafts and must be approved before becoming active
          </div>
        </div>
        <Toggle checked={config.enabled} onChange={() => update('enabled', !config.enabled)} />
      </div>

      {config.enabled && (
        <div className="space-y-4 pt-2 border-t">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-sm">Auto-Approve</div>
              <div className="text-xs text-neutral-500">
                Automatically approve contingent tasks as they approach their scheduled date
              </div>
            </div>
            <Toggle
              checked={config.auto_approve_enabled}
              onChange={() => update('auto_approve_enabled', !config.auto_approve_enabled)}
            />
          </div>

          {config.auto_approve_enabled && (
            <div className="flex items-center gap-2 flex-wrap pl-4 border-l-2 border-purple-200 dark:border-purple-800">
              <span className="text-sm text-neutral-600 dark:text-neutral-400">Approve</span>
              <Input
                type="number"
                min={0}
                value={config.auto_approve_days}
                onChange={(e) => update('auto_approve_days', parseInt(e.target.value) || 0)}
                className="w-20 h-9"
              />
              <span className="text-sm text-neutral-600 dark:text-neutral-400">day(s) before scheduled date</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
