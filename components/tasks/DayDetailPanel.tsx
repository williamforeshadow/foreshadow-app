'use client';

import React, { useMemo } from 'react';
import { format } from 'date-fns';
import { X, Plus, ChevronRight } from 'lucide-react';
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

export interface DayDetailReservation {
  id: string;
  guest_name?: string | null;
  /**
   * Whether the panel's date is this reservation's check-in day. Drives a
   * left-side diagonal cut on the row (mirroring the "starting tip" of a
   * reservation bar in the timeline).
   */
  isCheckIn?: boolean;
  /**
   * Whether the panel's date is this reservation's check-out day. Drives a
   * right-side diagonal cut on the row (mirroring the "ending tip" of a
   * reservation bar in the timeline).
   */
  isCheckOut?: boolean;
}

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
  /**
   * Reservations whose stay window covers this day (check_in <= date <=
   * check_out). When provided + non-empty, an "Active reservation(s)"
   * section renders above "Tasks scheduled" with one clickable row per
   * reservation. On same-day flips this naturally yields two entries
   * (outgoing + incoming). Surfaces that don't want this section can
   * simply omit the prop.
   */
  activeReservations?: DayDetailReservation[];
  /**
   * Click handler for a row in the Active reservation(s) section. Receives
   * the reservation_id; surfaces typically forward this to
   * `useReservationViewer().open(id)` to open the global reservation
   * detail overlay.
   */
  onReservationClick?: (reservationId: string) => void;
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
  activeReservations,
  onReservationClick,
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
          {/* Active reservation(s) — renders one timeline-style bar per
              reservation covering this day. Each row mirrors the bar
              geometry on the calendar/timeline grids: a left diagonal cut
              when this day is the reservation's check-in, a right diagonal
              cut when it's the check-out, and a flat rounded pill when
              it's mid-stay. On a same-day flip the section naturally
              renders two rows with opposite-side cuts (outgoing first,
              incoming second), which traces the handover between the two
              stays. Geometry uses the same diagonalPx/clipPath formula as
              TimelineWindow's reservation bar (~line 1592) so the two
              surfaces read as one component. */}
          {activeReservations && activeReservations.length > 0 && (
            <section className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="text-[10px] italic font-medium tracking-[0.08em] uppercase text-neutral-400 dark:text-[#66645f]">
                  {activeReservations.length === 1
                    ? 'Active reservation'
                    : 'Active reservations'}
                </div>
                {activeReservations.length > 1 && (
                  <div className="text-[11px] font-medium text-neutral-500 dark:text-[#a09e9a] tabular-nums">
                    {activeReservations.length}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                {activeReservations.map((res) => {
                  const clickable = !!onReservationClick;
                  const cutLeft = !!res.isCheckIn;
                  const cutRight = !!res.isCheckOut;
                  const diagonalPx = 12;
                  const leftCut = cutLeft ? `${diagonalPx}px` : '0px';
                  const rightCut = cutRight ? `${diagonalPx}px` : '0px';
                  const clipPath =
                    cutLeft || cutRight
                      ? `polygon(${leftCut} 0%, 100% 0%, calc(100% - ${rightCut}) 100%, 0% 100%)`
                      : undefined;
                  // Mirror the timeline bar's borderRadius rule: zero out
                  // any corner that's been clipped, full radius elsewhere.
                  const borderRadius =
                    cutLeft && cutRight
                      ? '0'
                      : cutLeft
                      ? '0 8px 8px 0'
                      : cutRight
                      ? '8px 0 0 8px'
                      : '8px';
                  // Extra horizontal padding on cut sides so the title +
                  // chevron clear the diagonal edges (matches the timeline
                  // bar's diagonalPx + 6 inner padding pattern).
                  const paddingLeft = cutLeft ? diagonalPx + 8 : 12;
                  const paddingRight = cutRight ? diagonalPx + 8 : 12;
                  return (
                    <button
                      key={res.id}
                      type="button"
                      onClick={
                        clickable ? () => onReservationClick!(res.id) : undefined
                      }
                      disabled={!clickable}
                      style={{
                        clipPath,
                        borderRadius,
                        paddingLeft,
                        paddingRight,
                      }}
                      className={`w-full flex items-center justify-between gap-3 py-2.5 text-left border-t bg-[var(--turnover-purple-bg)] border-[var(--turnover-purple-border)] transition-colors ${
                        clickable
                          ? 'hover:bg-[var(--turnover-purple-bg-hover)] cursor-pointer'
                          : 'cursor-default'
                      }`}
                    >
                      <span className="text-[13px] font-medium text-[#1a1a18] dark:text-[#f0efed] truncate">
                        {res.guest_name || 'No guest'}
                      </span>
                      {clickable && (
                        <ChevronRight
                          size={14}
                          className="text-[var(--accent-3)] dark:text-[var(--accent-1)] shrink-0"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
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
