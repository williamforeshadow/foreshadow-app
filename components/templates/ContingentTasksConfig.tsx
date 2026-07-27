'use client';

import {
  SectionLabel,
  SentenceRow,
  SentenceText,
  TokenNumber,
  ToggleRow,
} from '@/components/ui/panel/PanelForm';
import type { ContingentTasksConfig as ContingentConfig } from '@/lib/types';
import InfoTooltip from './InfoTooltip';

// ============================================================================
// Props
// ============================================================================

interface ContingentTasksConfigProps {
  config: ContingentConfig;
  onChange: (config: ContingentConfig) => void;
}

// ============================================================================
// Component
//
// Renders as a labelled band of rows in the parent form's flow (not a card) —
// see components/ui/panel/PanelForm.
// ============================================================================

export default function ContingentTasksConfig({ config, onChange }: ContingentTasksConfigProps) {
  const update = (field: keyof ContingentConfig, value: unknown) => {
    onChange({ ...config, [field]: value });
  };

  return (
    <>
      <SectionLabel>Approval</SectionLabel>

      <ToggleRow
        label="Generate as Contingent"
        hint={<InfoTooltip text="Tasks are created as drafts and must be approved before becoming active" />}
        checked={config.enabled}
        onChange={() => update('enabled', !config.enabled)}
      />

      {config.enabled && (
        <>
          <ToggleRow
            label="Auto-Approve"
            hint={<InfoTooltip text="Automatically approve contingent tasks as they approach their scheduled date" />}
            checked={config.auto_approve_enabled}
            onChange={() => update('auto_approve_enabled', !config.auto_approve_enabled)}
          />

          {config.auto_approve_enabled && (
            <SentenceRow>
              <SentenceText>Approve</SentenceText>
              <TokenNumber
                ariaLabel="Auto-approve days"
                min={0}
                value={config.auto_approve_days}
                onChange={(next) => update('auto_approve_days', next || 0)}
              />
              <SentenceText>day(s) before scheduled date</SentenceText>
            </SentenceRow>
          )}
        </>
      )}
    </>
  );
}
