import type { LucideIcon } from 'lucide-react';
import { STATUS_ICONS, STATUS_TITLE } from '@/lib/taskStatusIcons';

// Status visuals for the unified task detail panel, matched exactly to the
// kanban task cards (same lucide icons from lib/taskStatusIcons, same colors
// from ProjectsKanban.module.css) so a task reads the same everywhere.

// User-selectable statuses (contingent is system-only — set by automations /
// proposals, never chosen in the picker).
export const SELECTABLE_STATUSES = [
  'not_started',
  'in_progress',
  'paused',
  'complete',
] as const;

export type SelectableStatus = (typeof SELECTABLE_STATUSES)[number];

// Tailwind color classes (light / dark) mirroring the kanban status badge.
// Applied to both the icon (currentColor) and the label.
export const STATUS_COLOR_CLASS: Record<string, string> = {
  not_started: 'text-[#A78BFA]',
  in_progress: 'text-[#6366F1] dark:text-[#818CF8]',
  paused: 'text-[#8B7FA8] dark:text-[#a899c2]',
  complete: 'text-[#4C4869] dark:text-[#6e6a8a]',
  contingent: 'text-[#8B7FA8] dark:text-[#a899c2]',
};

export function statusIcon(status: string | null | undefined): LucideIcon {
  return STATUS_ICONS[status ?? 'not_started'] ?? STATUS_ICONS.not_started;
}

export function statusLabel(status: string | null | undefined): string {
  return STATUS_TITLE[status ?? 'not_started'] ?? STATUS_TITLE.not_started;
}

export function statusColorClass(status: string | null | undefined): string {
  return STATUS_COLOR_CLASS[status ?? 'not_started'] ?? STATUS_COLOR_CLASS.not_started;
}
