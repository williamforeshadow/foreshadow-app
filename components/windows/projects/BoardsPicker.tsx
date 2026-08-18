'use client';

import { useState } from 'react';
import { AdaptivePicker } from '@/components/tasks/detail/primitives/AdaptivePicker';
import { TaskOptionRow } from '@/components/tasks/detail/primitives/TaskSheet';
import type { ProjectViewMode } from '@/lib/types';

// The "Boards" pill — picks the kanban's board orientation (which field the
// columns group by). Single-select: choosing a mode applies and closes, like
// a badge picker. Standard picker surface: anchored popover on desktop,
// bottom drawer on mobile. Shared by the desktop ProjectsWindow and
// MobileProjectsView so the pill can't drift between platforms.

export const VIEW_MODE_LABELS: Record<ProjectViewMode, string> = {
  property: 'Property',
  status: 'Status',
  priority: 'Priority',
  department: 'Dept',
  assignee: 'Assignee',
};

const ALL_VIEW_MODES: ProjectViewMode[] = [
  'property',
  'status',
  'priority',
  'department',
  'assignee',
];

export function BoardsPicker({
  viewMode,
  setViewMode,
}: {
  viewMode: ProjectViewMode;
  setViewMode: (m: ProjectViewMode) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <AdaptivePicker
      open={open}
      onOpenChange={setOpen}
      title="Boards"
      align="end"
      trigger={
        <button className="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium border transition-colors bg-transparent text-neutral-600 dark:text-[#a09e9a] border-neutral-200 dark:border-[rgba(255,255,255,0.08)] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] hover:text-neutral-800 dark:hover:text-[#f0efed]">
          <span>Boards</span>
          <svg className={`w-3 h-3 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      }
    >
      <div className="pb-1">
        {ALL_VIEW_MODES.map((mode) => (
          <TaskOptionRow
            key={mode}
            selected={viewMode === mode}
            onSelect={() => {
              setViewMode(mode);
              setOpen(false);
            }}
          >
            {VIEW_MODE_LABELS[mode]}
          </TaskOptionRow>
        ))}
      </div>
    </AdaptivePicker>
  );
}
