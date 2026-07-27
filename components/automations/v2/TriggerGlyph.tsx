'use client';

import * as React from 'react';
import type { AutomationTrigger } from '@/lib/automations/types';

// Glyphs for the two automation triggers, in the same house style as the task
// panel's icon set (24 viewBox, stroke 1.5, round caps) so a Slack automation
// row reads like a task automation row. `muted` drops it to the faint ink,
// matching DeptGlyph's treatment of an automation that isn't live.

const PATHS: Record<AutomationTrigger['kind'], React.ReactNode> = {
  // A clock — the automation fires on a cadence.
  schedule: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  // A table — the automation fires when a row changes.
  row_change: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M3.5 9.5h17M3.5 14.5h17" />
    </>
  ),
};

export function TriggerGlyph({
  kind,
  size = 17,
  muted,
}: {
  kind: AutomationTrigger['kind'];
  size?: number;
  muted?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ color: muted ? 'var(--task-ink-3)' : 'var(--task-ink-2)' }}
    >
      {PATHS[kind] ?? PATHS.schedule}
    </svg>
  );
}
