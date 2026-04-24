'use client';

import React from 'react';
import { format, parseISO, differenceInCalendarDays } from 'date-fns';
import { X, Calendar, User, Clock, CheckCircle2, Circle, Sparkles } from 'lucide-react';
import type { ScheduleReservation, ScheduleTask } from './MonthGrid';

// Lightweight detail panel for a reservation. Mirrors the absolute-overlay
// shape of PropertyTasksView's task panel so it can sit on the same anchor
// (the /properties main column with `relative`). Shows:
//   - guest + date window
//   - nights, "Turnover in N days" countdown if applicable
//   - list of scheduled tasks that fall inside the stay window (clicking
//     one surfaces a lightweight read-only task peek below)
//
// Full task editing still lives on the Tasks tab; this panel is for quick
// orientation, matching the "relatively simple" scope the user asked for.

interface ReservationDetailPanelProps {
  reservation: ScheduleReservation & { property_name?: string };
  allTasks: ScheduleTask[];
  onClose: () => void;
  onOpenTask?: (task: ScheduleTask) => void;
}

function toDateOnly(raw: string): Date {
  const slice = raw.length >= 10 ? raw.slice(0, 10) : raw;
  return parseISO(`${slice}T00:00:00`);
}

const STATUS_META: Record<
  string,
  { label: string; icon: typeof Circle; className: string }
> = {
  complete: {
    label: 'Complete',
    icon: CheckCircle2,
    className: 'text-emerald-600 dark:text-emerald-400',
  },
  in_progress: {
    label: 'In progress',
    icon: Sparkles,
    className: 'text-[var(--accent-3)] dark:text-[var(--accent-1)]',
  },
  not_started: {
    label: 'Not started',
    icon: Circle,
    className: 'text-neutral-400 dark:text-[#66645f]',
  },
};

export function ReservationDetailPanel({
  reservation,
  allTasks,
  onClose,
  onOpenTask,
}: ReservationDetailPanelProps) {
  const checkIn = toDateOnly(reservation.check_in);
  const checkOut = toDateOnly(reservation.check_out);
  const nights = Math.max(1, differenceInCalendarDays(checkOut, checkIn));

  const nextCheckIn = reservation.next_check_in
    ? toDateOnly(reservation.next_check_in)
    : null;
  const turnoverGap = nextCheckIn
    ? differenceInCalendarDays(nextCheckIn, checkOut)
    : null;

  const stayTasks = React.useMemo(() => {
    const ciKey = format(checkIn, 'yyyy-MM-dd');
    const coKey = format(checkOut, 'yyyy-MM-dd');
    return allTasks
      .filter((t) => {
        if (!t.scheduled_date) return false;
        if (t.reservation_id && t.reservation_id === reservation.id) return true;
        const d = t.scheduled_date.slice(0, 10);
        return d >= ciKey && d <= coKey;
      })
      .sort((a, b) => {
        const ad = (a.scheduled_date || '').localeCompare(b.scheduled_date || '');
        if (ad !== 0) return ad;
        return (a.scheduled_time || '').localeCompare(b.scheduled_time || '');
      });
  }, [allTasks, checkIn, checkOut, reservation.id]);

  return (
    <div className="h-full w-full flex flex-col bg-white dark:bg-[#0b0b0c]">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-6 pt-6 pb-4 border-b border-[rgba(30,25,20,0.06)] dark:border-white/5">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="text-[10px] italic font-medium tracking-[0.08em] uppercase text-neutral-400 dark:text-[#66645f]">
            Reservation
          </div>
          <div className="text-[18px] font-semibold text-neutral-900 dark:text-[#f0efed] truncate">
            {reservation.guest_name || 'Unnamed guest'}
          </div>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full hover:bg-neutral-100 dark:hover:bg-white/5 text-neutral-500 dark:text-[#a09e9a]"
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto">
        <div className="px-6 py-5 flex flex-col gap-6">
          {/* Stay summary */}
          <section className="flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center bg-[var(--accent-bg-soft)] dark:bg-[var(--accent-bg-soft-dark)] text-[var(--accent-3)] dark:text-[var(--accent-1)] shrink-0">
                <Calendar size={14} />
              </div>
              <div className="flex flex-col gap-0.5">
                <div className="text-[11px] italic text-neutral-400 dark:text-[#66645f]">
                  Check-in → Check-out
                </div>
                <div className="text-[13px] font-medium text-neutral-800 dark:text-[#e5e4e2]">
                  {format(checkIn, 'EEE, MMM d')} → {format(checkOut, 'EEE, MMM d')}
                </div>
                <div className="text-[12px] text-neutral-500 dark:text-[#a09e9a]">
                  {nights} night{nights === 1 ? '' : 's'}
                </div>
              </div>
            </div>

            {nextCheckIn && turnoverGap !== null && (
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full flex items-center justify-center bg-[var(--accent-bg-soft)] dark:bg-[var(--accent-bg-soft-dark)] text-[var(--accent-3)] dark:text-[var(--accent-1)] shrink-0">
                  <Clock size={14} />
                </div>
                <div className="flex flex-col gap-0.5">
                  <div className="text-[11px] italic text-neutral-400 dark:text-[#66645f]">
                    Next check-in
                  </div>
                  <div className="text-[13px] font-medium text-neutral-800 dark:text-[#e5e4e2]">
                    {format(nextCheckIn, 'EEE, MMM d')}
                  </div>
                  <div className="text-[12px] text-neutral-500 dark:text-[#a09e9a]">
                    {turnoverGap === 0
                      ? 'Same-day turnover'
                      : `${turnoverGap} day${turnoverGap === 1 ? '' : 's'} between stays`}
                  </div>
                </div>
              </div>
            )}

            {reservation.guest_name && (
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full flex items-center justify-center bg-[var(--accent-bg-soft)] dark:bg-[var(--accent-bg-soft-dark)] text-[var(--accent-3)] dark:text-[var(--accent-1)] shrink-0">
                  <User size={14} />
                </div>
                <div className="flex flex-col gap-0.5">
                  <div className="text-[11px] italic text-neutral-400 dark:text-[#66645f]">
                    Guest
                  </div>
                  <div className="text-[13px] font-medium text-neutral-800 dark:text-[#e5e4e2]">
                    {reservation.guest_name}
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* Tasks in this stay */}
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="text-[10px] italic font-medium tracking-[0.08em] uppercase text-neutral-400 dark:text-[#66645f]">
                Tasks during stay
              </div>
              <div className="text-[11px] font-medium text-neutral-500 dark:text-[#a09e9a] tabular-nums">
                {stayTasks.length}
              </div>
            </div>

            {stayTasks.length === 0 ? (
              <div className="text-[12px] text-neutral-400 dark:text-[#66645f] italic py-4">
                No scheduled tasks in this window.
              </div>
            ) : (
              <ul className="flex flex-col gap-1">
                {stayTasks.map((task) => {
                  const meta =
                    STATUS_META[task.status] || STATUS_META.not_started;
                  const Icon = meta.icon;
                  const dateLabel = task.scheduled_date
                    ? format(toDateOnly(task.scheduled_date), 'MMM d')
                    : '';
                  return (
                    <li key={task.task_id}>
                      <button
                        onClick={() => onOpenTask?.(task)}
                        className="w-full text-left flex items-start gap-3 px-3 py-2 rounded-lg hover:bg-[var(--accent-bg-soft)] dark:hover:bg-[var(--accent-bg-soft-dark)] transition-colors"
                      >
                        <Icon
                          size={14}
                          className={`${meta.className} mt-0.5 shrink-0`}
                        />
                        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                          <div className="text-[13px] font-medium text-neutral-800 dark:text-[#e5e4e2] truncate">
                            {task.title || task.template_name || 'Task'}
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-neutral-500 dark:text-[#a09e9a]">
                            <span>{dateLabel}</span>
                            {task.scheduled_time && (
                              <>
                                <span aria-hidden>·</span>
                                <span className="tabular-nums">
                                  {task.scheduled_time.slice(0, 5)}
                                </span>
                              </>
                            )}
                            <span aria-hidden>·</span>
                            <span className={meta.className}>{meta.label}</span>
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
