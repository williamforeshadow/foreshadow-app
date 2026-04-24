'use client';

import React, { useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import { X, Plus, Calendar as CalendarIcon } from 'lucide-react';
import { TaskRow, TaskListHeader, type TaskRowItem } from './TaskRow';
import { MobileTaskRow } from './MobileTaskRow';
import { useIsMobile } from '@/lib/useIsMobile';
import { getDepartmentIcon } from '@/lib/departmentIcons';

// Shared "click a day → see its schedule" detail panel.
//
// Surfaces:
//   - Property Schedule: scoped to one property + one day (tasks + reservations
//     from that property).
//   - Timeline: all-properties, one day (tasks + reservations spanning any
//     property). Consumers pass `showPropertyOnRows` so the per-row property
//     slug shows up inline.
//
// This component renders content only; the parent owns the outer positioning
// (absolute right-1/3 on desktop, fixed inset-0 on mobile) — same contract as
// ReservationDetailPanel / MobileProjectDetail.

export interface DayPanelReservation {
  id: string;
  guest_name: string | null;
  check_in: string; // YYYY-MM-DD or ISO
  check_out: string;
  property_name?: string | null;
}

interface DayDetailPanelProps {
  date: Date;
  /**
   * Heading row. Typically the property name on the Property Schedule, or
   * "All properties" on the Timeline.
   */
  title?: string;
  onClose: () => void;
  /** Reservations active on this day (strip at the top). */
  reservations?: DayPanelReservation[];
  onReservationClick?: (reservation: DayPanelReservation) => void;
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

function toDateOnly(raw: string): Date {
  const slice = raw.length >= 10 ? raw.slice(0, 10) : raw;
  return parseISO(`${slice}T00:00:00`);
}

export function DayDetailPanel({
  date,
  title,
  onClose,
  reservations = [],
  onReservationClick,
  tasks,
  onTaskClick,
  showPropertyOnRows = false,
  onNewTask,
}: DayDetailPanelProps) {
  const isMobile = useIsMobile();
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
      <div
        className={`flex items-start justify-between gap-3 px-5 sm:px-6 ${
          isMobile ? 'pt-4' : 'pt-6'
        } pb-4 border-b border-[rgba(30,25,20,0.06)] dark:border-white/5`}
      >
        <div className="flex flex-col gap-1 min-w-0">
          <div className="text-[10px] italic font-medium tracking-[0.08em] uppercase text-neutral-400 dark:text-[#66645f]">
            {format(date, 'EEEE')}
          </div>
          <div className="text-[22px] font-semibold text-neutral-900 dark:text-[#f0efed] leading-tight">
            {format(date, 'MMM d, yyyy')}
          </div>
          {title && (
            <div className="text-[12px] text-neutral-500 dark:text-[#a09e9a] truncate">
              {title}
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
          {/* Reservations active on this day */}
          {reservations.length > 0 && (
            <section className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="text-[10px] italic font-medium tracking-[0.08em] uppercase text-neutral-400 dark:text-[#66645f]">
                  Reservations active today
                </div>
                <div className="text-[11px] font-medium text-neutral-500 dark:text-[#a09e9a] tabular-nums">
                  {reservations.length}
                </div>
              </div>
              <ul className="flex flex-col gap-1">
                {reservations.map((r) => {
                  const ci = toDateOnly(r.check_in);
                  const co = toDateOnly(r.check_out);
                  return (
                    <li key={r.id}>
                      <button
                        onClick={() => onReservationClick?.(r)}
                        className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg border border-[rgba(167,139,250,0.26)] dark:border-[rgba(167,139,250,0.30)] bg-[rgba(167,139,250,0.10)] dark:bg-[rgba(167,139,250,0.12)] hover:bg-[rgba(167,139,250,0.16)] dark:hover:bg-[rgba(167,139,250,0.18)] transition-colors"
                      >
                        <div className="w-7 h-7 rounded-full flex items-center justify-center bg-white/60 dark:bg-white/5 text-[var(--accent-3)] dark:text-[var(--accent-1)] shrink-0">
                          <CalendarIcon size={13} />
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                          <div className="text-[13px] font-medium text-neutral-800 dark:text-[#e5e4e2] truncate">
                            {r.guest_name || 'Unnamed guest'}
                          </div>
                          <div className="text-[11px] text-neutral-500 dark:text-[#a09e9a] truncate">
                            {format(ci, 'MMM d')} → {format(co, 'MMM d')}
                            {r.property_name ? ` · ${r.property_name}` : ''}
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

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
            ) : isMobile ? (
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
            ) : (
              <div>
                <TaskListHeader />
                {orderedTasks.map((t, idx) => {
                  const DeptIcon = t.department_id
                    ? getDepartmentIcon(t.department_id)
                    : undefined;
                  return (
                    <TaskRow
                      key={t.key}
                      item={t}
                      isLast={idx === orderedTasks.length - 1}
                      onClick={() => onTaskClick(t.key)}
                      hideProperty={!showPropertyOnRows}
                      showBinPill
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
