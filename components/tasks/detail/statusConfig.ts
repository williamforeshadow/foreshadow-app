import type { TaskStatus } from '@/lib/types';

// The one status map for the unified task detail panel. Colors reference the
// scoped .task-detail tokens (see globals.css): purple = live/in progress,
// amber = paused, green = complete, muted = not started. `contingent` is a
// system-only state (set by automations/proposals): locked treatment, never
// user-selectable, excluded from the pip progression.

export const SELECTABLE_STATUSES = [
  'not_started',
  'in_progress',
  'paused',
  'complete',
] as const;

export type SelectableStatus = (typeof SELECTABLE_STATUSES)[number];

// Pip progression: a linear not-started → in-progress → complete spine.
// Paused is not a stage — it renders as the in-progress pip going amber.
export const PIP_STAGES = ['not_started', 'in_progress', 'complete'] as const;

export interface StatusVisual {
  label: string;
  /** CSS color for the status's primary tint. */
  color: string;
  /** Soft background wash for chips/buttons in this state. */
  soft: string;
  /** Index on the pip spine (paused shares in_progress's position). */
  pipIndex: number;
}

export const STATUS_VISUALS: Record<TaskStatus, StatusVisual> = {
  not_started: {
    label: 'Not started',
    color: 'var(--task-ink-3)',
    soft: 'var(--task-surface-2)',
    pipIndex: 0,
  },
  in_progress: {
    label: 'In progress',
    color: 'var(--task-accent)',
    soft: 'var(--task-accent-soft)',
    pipIndex: 1,
  },
  paused: {
    label: 'Paused',
    color: 'var(--task-amber)',
    soft: 'var(--task-amber-soft)',
    pipIndex: 1,
  },
  complete: {
    label: 'Complete',
    color: 'var(--task-green)',
    soft: 'var(--task-green-soft)',
    pipIndex: 2,
  },
  contingent: {
    label: 'Contingent',
    color: 'var(--task-accent-dim)',
    soft: 'var(--task-accent-soft)',
    pipIndex: 0,
  },
};

export function statusVisual(status: string | null | undefined): StatusVisual {
  return STATUS_VISUALS[(status as TaskStatus) ?? 'not_started'] ?? STATUS_VISUALS.not_started;
}

/** The rail/pulse color: green when complete, amber when paused, purple when
 *  running, muted otherwise. */
export function railColor(status: string | null | undefined, timerRunning: boolean): string {
  if (status === 'complete') return 'var(--task-green)';
  if (status === 'paused') return 'var(--task-amber)';
  if (timerRunning || status === 'in_progress') return 'var(--task-accent)';
  return 'var(--task-ink-3)';
}
