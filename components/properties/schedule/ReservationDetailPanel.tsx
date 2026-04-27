'use client';

import React from 'react';
import { format, parseISO, differenceInCalendarDays } from 'date-fns';
import { X, Calendar, User, Clock } from 'lucide-react';
import type { ScheduleReservation, ScheduleTask } from './MonthGrid';
import { useOperationsSettings } from '@/lib/operationsSettingsContext';
import { useDepartments } from '@/lib/departmentsContext';
import { getDepartmentIcon } from '@/lib/departmentIcons';
import { MobileTaskRow } from '@/components/tasks/MobileTaskRow';
import type { TaskRowItem } from '@/components/tasks/TaskRow';
import { ReservationContextOverride } from '@/lib/reservationViewerContext';

// Lightweight detail panel for a reservation. Mirrors the absolute-overlay
// shape of PropertyTasksView's task panel so it can sit on the same anchor
// (the /properties main column with `relative`). Shows:
//   - guest + date window
//   - nights, "Turnover in N days" countdown if applicable
//   - list of "associated tasks" — i.e. any task whose scheduled moment falls
//     inside this reservation's turnover window:
//         [check_in @ defaultCheckInTime, next_check_in @ defaultCheckInTime)
//     The default check-in time comes from operations_settings (org-wide) so
//     that on same-day turnovers, tasks scheduled before the changeover hour
//     belong to the outgoing reservation while tasks at or after belong to
//     the incoming one. When next_check_in is null the upper bound is
//     open-ended (the caller supplies tasks accordingly).
//
//     Tasks no longer need a reservation_id match — scheduled-moment-in-window
//     is the sole qualifier so that re-scheduling a task naturally
//     re-associates it with whichever reservation owns the new slot.
//
//     Comparisons are done as 'YYYY-MM-DDTHH:MM' string lex compares to stay
//     timezone-agnostic, matching the rest of the app.
//
// Rows render through the shared <MobileTaskRow /> so the visual is
// identical to My Assignments (mobile) and Property Tasks (mobile). On
// desktop the panel is narrow (~1/3 column), so the mobile-style row fits
// both surfaces — no separate desktop variant is needed here.
//
// Tasks with a non-null reservation_id render a small key icon next to
// the title (hover reveals "Scheduled relative to reservation").
// Recurring tasks have no reservation_id, so they render plain — same as
// manually-created tasks.
//
// Clicking a task hands off to the parent's `onOpenTask`, which surfaces
// the full shared task overlay.

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

export function ReservationDetailPanel({
  reservation,
  allTasks,
  onClose,
  onOpenTask,
}: ReservationDetailPanelProps) {
  const { settings } = useOperationsSettings();
  const { departments: allDepts } = useDepartments();
  const defaultCheckInTime = (settings.default_check_in_time || '15:00').slice(0, 5);

  const checkIn = toDateOnly(reservation.check_in);
  const checkOut = toDateOnly(reservation.check_out);
  const nights = Math.max(1, differenceInCalendarDays(checkOut, checkIn));

  const nextCheckIn = reservation.next_check_in
    ? toDateOnly(reservation.next_check_in)
    : null;
  const turnoverGap = nextCheckIn
    ? differenceInCalendarDays(nextCheckIn, checkOut)
    : null;

  // Turnover window = [check_in @ defaultCheckInTime, next_check_in @
  // defaultCheckInTime). Open-ended when there's no next_check_in.
  //
  // We compose 'YYYY-MM-DDTHH:MM' strings on both sides and compare
  // lexicographically — never instantiating Date objects — so the comparison
  // is wall-clock and timezone-agnostic, matching the rest of the app's
  // convention.
  //
  // Tasks missing scheduled_time fall back to '00:00' so they sort with the
  // earliest moment of their day. With Auto-Scheduling now mandatory for
  // automated tasks this is rare in practice.
  //
  // Scheduled-moment-in-window is the sole qualifier — we deliberately do
  // NOT short-circuit on reservation_id, so re-scheduling a task naturally
  // re-associates it to whichever reservation owns the new slot.
  const associatedTasks = React.useMemo(() => {
    const ciDate = format(checkIn, 'yyyy-MM-dd');
    const startKey = `${ciDate}T${defaultCheckInTime}`;
    const endKey = nextCheckIn
      ? `${format(nextCheckIn, 'yyyy-MM-dd')}T${defaultCheckInTime}`
      : null;

    return allTasks
      .filter((t) => {
        if (!t.scheduled_date) return false;
        const d = t.scheduled_date.slice(0, 10);
        const time = (t.scheduled_time || '').slice(0, 5) || '00:00';
        const key = `${d}T${time}`;
        if (key < startKey) return false;
        if (endKey && key >= endKey) return false;
        return true;
      })
      .sort((a, b) => {
        const ad = (a.scheduled_date || '').localeCompare(b.scheduled_date || '');
        if (ad !== 0) return ad;
        return (a.scheduled_time || '').localeCompare(b.scheduled_time || '');
      });
  }, [allTasks, checkIn, nextCheckIn, defaultCheckInTime]);

  return (
    <ReservationContextOverride id={reservation.id}>
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

          {/* Tasks scheduled inside this reservation's turnover window */}
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="text-[10px] italic font-medium tracking-[0.08em] uppercase text-neutral-400 dark:text-[#66645f]">
                Associated tasks
              </div>
              <div className="text-[11px] font-medium text-neutral-500 dark:text-[#a09e9a] tabular-nums">
                {associatedTasks.length}
              </div>
            </div>

            {associatedTasks.length === 0 ? (
              <div className="text-[12px] text-neutral-400 dark:text-[#66645f] italic py-4">
                No scheduled tasks in this window.
              </div>
            ) : (
              <div className="flex flex-col">
                {associatedTasks.map((task, idx) => {
                  const item: TaskRowItem = {
                    key: task.task_id,
                    title: task.title || task.template_name || 'Task',
                    property_name: task.property_name || null,
                    status: task.status || 'not_started',
                    priority: task.priority || 'medium',
                    department_id: task.department_id || null,
                    department_name: task.department_name || null,
                    scheduled_date: task.scheduled_date,
                    scheduled_time: task.scheduled_time,
                    assignees: (task.assigned_users || []).map((u) => ({
                      user_id: u.user_id,
                      name: u.name,
                      avatar: u.avatar,
                    })),
                    bin_id: task.bin_id || null,
                    bin_name: task.bin_name || null,
                    is_binned: !!task.is_binned,
                    // The row paints a small key icon next to the title
                    // when this is set. Recurring tasks have no
                    // reservation_id, so they render plain — same as
                    // manual tasks.
                    reservation_id: task.reservation_id || null,
                  };
                  const dept = allDepts.find(
                    (d) => d.id === task.department_id
                  );
                  const DeptIcon = getDepartmentIcon(dept?.icon);
                  return (
                    <MobileTaskRow
                      key={task.task_id}
                      item={item}
                      isLast={idx === associatedTasks.length - 1}
                      onClick={() => onOpenTask?.(task)}
                      hideProperty
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
    </ReservationContextOverride>
  );
}
