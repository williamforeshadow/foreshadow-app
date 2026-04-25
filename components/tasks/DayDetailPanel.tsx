'use client';

import React, { useMemo } from 'react';
import { format } from 'date-fns';
import { X, Plus } from 'lucide-react';
import { type TaskRowItem } from './TaskRow';
import { MobileTaskRow } from './MobileTaskRow';
import { getDepartmentIcon } from '@/lib/departmentIcons';

// Shared "click a day → see its schedule" detail panel.
//
// Surfaces:
//   - Property Schedule: scoped to one property + one day. Header shows an
//     occupied / vacant pill so the user can see at a glance whether the
//     property has a reservation in residence on that day.
//   - Timeline: all-properties, one day. No occupancy pill (there's no
//     single occupancy state across properties); rows show the property
//     slug inline via `showPropertyOnRows`.
//
// Rows always use the compact MobileTaskRow layout regardless of viewport
// — the panel is only ~1/3 of the screen on desktop, so a multi-column
// row would get squished.
//
// This component renders content only; the parent owns the outer
// positioning (absolute right-1/3 on desktop, fixed inset-0 on mobile) —
// same contract as ReservationDetailPanel / MobileProjectDetail.

interface DayDetailPanelProps {
  date: Date;
  /**
   * Heading row. Typically the property name on the Property Schedule, or
   * "All properties" on the Timeline.
   */
  title?: string;
  onClose: () => void;
  /**
   * Optional occupancy badge for single-property surfaces. Omitted on the
   * Timeline (all-properties view has no single state).
   */
  occupancy?: 'occupied' | 'vacant';
  /** Tasks scheduled on this day. */
  tasks: TaskRowItem[];
  /**
   * Called with the TaskRowItem's `key`. Each surface resolves the key back
   * to its own internal task shape and opens its own detail panel, keeping
   * DayDetailPanel decoupled from any one surface's state.
   */
  onTaskClick: (taskKey: string) => void;
  /**
   * Show the per-row property label on tasks. Default false (assumes a
   * single-property context). Turn on for the Timeline day panel.
   */
  showPropertyOnRows?: boolean;
  /**
   * Optional "New task" shortcut. Callback receives the YYYY-MM-DD of this
   * day so consumers can pre-fill the draft.
   */
  onNewTask?: (dateStr: string) => void;
}

function OccupancyPill({ occupancy }: { occupancy: 'occupied' | 'vacant' }) {
  const isOccupied = occupancy === 'occupied';
  const className = isOccupied
    ? 'border border-[rgba(167,139,250,0.32)] dark:border-[rgba(167,139,250,0.36)] bg-[rgba(167,139,250,0.14)] dark:bg-[rgba(167,139,250,0.18)] text-[var(--accent-3)] dark:text-[var(--accent-1)]'
    : 'border border-[rgba(30,25,20,0.10)] dark:border-white/10 bg-neutral-100 dark:bg-white/5 text-neutral-500 dark:text-[#a09e9a]';
  return (
    <span
      className={`inline-flex items-center h-[20px] px-2 rounded-full text-[10px] font-medium tracking-[0.04em] uppercase ${className}`}
    >
      {isOccupied ? 'Occupied' : 'Vacant'}
    </span>
  );
}

export function DayDetailPanel({
  date,
  title,
  onClose,
  occupancy,
  tasks,
  onTaskClick,
  showPropertyOnRows = false,
  onNewTask,
}: DayDetailPanelProps) {
  const dateStr = format(date, 'yyyy-MM-dd');

  // Sort tasks: scheduled_time asc, then title. Group header already shows
  // the full date, so we keep rows flat.
  const orderedTasks = useMemo(() => {
    const copy = [...tasks];
    copy.sort((a, b) => {
      const ta = a.scheduled_time || '';
      const tb = b.scheduled_time || '';
      if (ta !== tb) return ta.localeCompare(tb);
      return (a.title || '').localeCompare(b.title || '');
    });
    return copy;
  }, [tasks]);

  return (
    <div className="h-full w-full flex flex-col bg-white dark:bg-[#0b0b0c]">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-5 sm:px-6 pt-6 pb-4 border-b border-[rgba(30,25,20,0.06)] dark:border-white/5">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="text-[10px] italic font-medium tracking-[0.08em] uppercase text-neutral-400 dark:text-[#66645f]">
            {format(date, 'EEEE')}
          </div>
          <div className="text-[22px] font-semibold text-neutral-900 dark:text-[#f0efed] leading-tight">
            {format(date, 'MMM d, yyyy')}
          </div>
          {(title || occupancy) && (
            <div className="flex items-center gap-2 mt-0.5">
              {title && (
                <span className="text-[12px] text-neutral-500 dark:text-[#a09e9a] truncate">
                  {title}
                </span>
              )}
              {occupancy && <OccupancyPill occupancy={occupancy} />}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {onNewTask && (
            <button
              onClick={() => onNewTask(dateStr)}
              className="h-8 pl-2 pr-3 rounded-lg border border-[rgba(30,25,20,0.08)] dark:border-white/10 text-[12px] font-medium text-neutral-700 dark:text-[#e5e4e2] hover:bg-[var(--accent-bg-soft)] dark:hover:bg-[var(--accent-bg-soft-dark)] hover:text-[var(--accent-3)] dark:hover:text-[var(--accent-1)] transition-colors flex items-center gap-1.5"
            >
              <Plus size={13} />
              <span>New task</span>
            </button>
          )}
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-neutral-100 dark:hover:bg-white/5 text-neutral-500 dark:text-[#a09e9a]"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto">
        <div className="px-5 sm:px-6 py-5 flex flex-col gap-6">
          {/* Tasks */}
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="text-[10px] italic font-medium tracking-[0.08em] uppercase text-neutral-400 dark:text-[#66645f]">
                Tasks scheduled
              </div>
              <div className="text-[11px] font-medium text-neutral-500 dark:text-[#a09e9a] tabular-nums">
                {orderedTasks.length}
              </div>
            </div>

            {orderedTasks.length === 0 ? (
              <div className="text-[12px] text-neutral-400 dark:text-[#66645f] italic py-4">
                No tasks scheduled for this day.
              </div>
            ) : (
              <div>
                {orderedTasks.map((t, idx) => {
                  const DeptIcon = t.department_id
                    ? getDepartmentIcon(t.department_id)
                    : undefined;
                  return (
                    <MobileTaskRow
                      key={t.key}
                      item={t}
                      isLast={idx === orderedTasks.length - 1}
                      onClick={() => onTaskClick(t.key)}
                      hideProperty={!showPropertyOnRows}
                      departmentIcon={DeptIcon}
                    />
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
