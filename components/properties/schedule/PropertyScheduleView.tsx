'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { addMonths, format, subMonths } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useProperty } from '../PropertyContext';
import { MonthGrid, type ScheduleReservation, type ScheduleTask } from './MonthGrid';
import { ReservationDetailPanel } from './ReservationDetailPanel';
import {
  PropertyTaskDetailOverlay,
  type OverlayTaskInput,
} from '../tasks/PropertyTaskDetailOverlay';
import { useIsMobile } from '@/lib/useIsMobile';

// Per-property Schedule tab. Month calendar with reservation bars + task
// pills, styled in the shared purple accent system to stay cohesive with
// Timeline / Bins / My Assignments. The detail panel is anchored as an
// absolute overlay on the outer `/properties` main column (PropertyTasksView
// uses the same pattern) so it spans viewport top → bottom, overriding the
// property header.

interface ScheduleApiResponse {
  property: { id: string; name: string };
  window: { start: string; end: string; year: number; month: number };
  reservations: ScheduleReservation[];
  tasks: ScheduleTask[];
}

export default function PropertyScheduleView() {
  const property = useProperty();
  const isMobile = useIsMobile();

  const [monthDate, setMonthDate] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [reservations, setReservations] = useState<ScheduleReservation[]>([]);
  const [tasks, setTasks] = useState<ScheduleTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedReservation, setSelectedReservation] = useState<
    ScheduleReservation | null
  >(null);
  const [selectedTask, setSelectedTask] = useState<OverlayTaskInput | null>(
    null
  );

  const year = monthDate.getFullYear();
  const month = monthDate.getMonth() + 1;

  const fetchSchedule = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/properties/${property.id}/schedule?year=${year}&month=${month}`
      );
      const data = (await res.json()) as ScheduleApiResponse | { error: string };
      if (!res.ok) {
        throw new Error(
          (data as { error: string }).error || 'Failed to load schedule'
        );
      }
      const payload = data as ScheduleApiResponse;
      setReservations(payload.reservations || []);
      setTasks(payload.tasks || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load schedule');
      setReservations([]);
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [property.id, year, month]);

  useEffect(() => {
    fetchSchedule();
  }, [fetchSchedule]);

  // Reservation list already inside the component; derive counts for the
  // header subtitle.
  const headerSubtitle = useMemo(() => {
    const resCount = reservations.length;
    const taskCount = tasks.length;
    const parts: string[] = [];
    parts.push(`${resCount} reservation${resCount === 1 ? '' : 's'}`);
    parts.push(`${taskCount} task${taskCount === 1 ? '' : 's'}`);
    return parts.join(' · ');
  }, [reservations.length, tasks.length]);

  const goPrev = () => setMonthDate((d) => subMonths(d, 1));
  const goNext = () => setMonthDate((d) => addMonths(d, 1));
  const goToday = () => {
    const now = new Date();
    setMonthDate(new Date(now.getFullYear(), now.getMonth(), 1));
  };

  // Clicking a task pill opens the full shared ProjectDetailPanel (same one
  // used on Timeline / Bins / Turnovers / Tasks) via PropertyTaskDetailOverlay.
  // All the fields the panel needs are already on the ScheduleTask payload;
  // we map to the overlay's input shape and rely on the reservation panel
  // closing when a task is selected (only one detail overlay at a time).
  const handleTaskClick = (task: ScheduleTask) => {
    const overlayInput: OverlayTaskInput = {
      task_id: task.task_id,
      reservation_id: task.reservation_id,
      property_id: task.property_id ?? property.id,
      property_name: task.property_name ?? property.name,
      template_id: task.template_id ?? null,
      template_name: task.template_name ?? null,
      title: task.title ?? null,
      description: task.description ?? null,
      priority: task.priority ?? 'medium',
      type: task.type,
      department_id: task.department_id ?? null,
      department_name: task.department_name ?? null,
      status: task.status,
      scheduled_date: task.scheduled_date,
      scheduled_time: task.scheduled_time,
      form_metadata: task.form_metadata ?? null,
      bin_id: task.bin_id ?? null,
      bin_name: task.bin_name ?? null,
      is_binned: !!task.is_binned,
      created_at: task.created_at ?? '',
      updated_at: task.updated_at ?? '',
      assigned_users: (task.assigned_users || []).map((u) => ({
        user_id: u.user_id,
        name: u.name,
        avatar: u.avatar,
        role: u.role,
      })),
    };
    setSelectedReservation(null);
    setSelectedTask(overlayInput);
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-5 sm:px-8 pt-5 sm:pt-6 pb-24 flex flex-col gap-4">
        {/* Month header */}
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div className="flex flex-col gap-0.5">
            <div className="text-[10px] italic font-medium tracking-[0.08em] uppercase text-neutral-400 dark:text-[#66645f]">
              Schedule
            </div>
            <div className="flex items-baseline gap-2">
              <h2 className="text-[22px] font-semibold text-neutral-900 dark:text-[#f0efed]">
                {format(monthDate, 'MMMM yyyy')}
              </h2>
            </div>
            <div className="text-[12px] text-neutral-500 dark:text-[#a09e9a] tabular-nums">
              {loading ? 'Loading…' : headerSubtitle}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={goPrev}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-[rgba(30,25,20,0.08)] dark:border-white/10 text-neutral-600 dark:text-[#a09e9a] hover:bg-[var(--accent-bg-soft)] dark:hover:bg-[var(--accent-bg-soft-dark)] hover:text-[var(--accent-3)] dark:hover:text-[var(--accent-1)] transition-colors"
              aria-label="Previous month"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={goToday}
              className="h-8 px-3 rounded-lg border border-[rgba(30,25,20,0.08)] dark:border-white/10 text-[12px] font-medium text-neutral-700 dark:text-[#e5e4e2] hover:bg-[var(--accent-bg-soft)] dark:hover:bg-[var(--accent-bg-soft-dark)] hover:text-[var(--accent-3)] dark:hover:text-[var(--accent-1)] transition-colors"
            >
              Today
            </button>
            <button
              onClick={goNext}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-[rgba(30,25,20,0.08)] dark:border-white/10 text-neutral-600 dark:text-[#a09e9a] hover:bg-[var(--accent-bg-soft)] dark:hover:bg-[var(--accent-bg-soft-dark)] hover:text-[var(--accent-3)] dark:hover:text-[var(--accent-1)] transition-colors"
              aria-label="Next month"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 px-3 py-2 text-[12px]">
            {error}
          </div>
        )}

        {/* Calendar grid */}
        <div className="rounded-xl border border-[rgba(30,25,20,0.08)] dark:border-white/10 bg-white dark:bg-[#0f0f11] overflow-hidden">
          <MonthGrid
            monthDate={monthDate}
            reservations={reservations}
            tasks={tasks}
            selectedReservationId={selectedReservation?.id ?? null}
            onReservationClick={(r) =>
              setSelectedReservation((prev) => (prev?.id === r.id ? null : r))
            }
            onTaskClick={handleTaskClick}
          />
        </div>
      </div>

      {/* Reservation detail panel.
          Desktop: absolute right-1/3 overlay anchored to the outer
                   /properties main column (which has `relative` on
                   app/properties/layout.tsx). Spans viewport top → bottom
                   so it overrides the property header.
          Mobile:  fixed full-screen sheet with safe-area padding, matching
                   the Bins tab / MobileProjectDetail pattern. */}
      {selectedReservation && !selectedTask && (
        <div
          className={
            isMobile
              ? 'fixed inset-0 z-[60] bg-white dark:bg-[#0b0b0c] safe-area-top safe-area-bottom flex flex-col'
              : 'absolute inset-y-0 right-0 w-1/3 z-20 border-l border-[rgba(30,25,20,0.08)] dark:border-white/10 bg-white dark:bg-[#0b0b0c] overflow-hidden flex flex-col'
          }
        >
          <ReservationDetailPanel
            reservation={selectedReservation}
            allTasks={tasks}
            onClose={() => setSelectedReservation(null)}
            onOpenTask={handleTaskClick}
          />
        </div>
      )}

      {/* Task detail panel — shared ProjectDetailPanel wrapped in the
          reusable overlay. Anchors to the same outer column for full-height
          coverage. Mutations refetch the schedule so edits (status, bin,
          assignees, etc.) reflect on the calendar immediately. */}
      <PropertyTaskDetailOverlay
        task={selectedTask}
        onClose={() => setSelectedTask(null)}
        onTaskUpdated={fetchSchedule}
      />
    </div>
  );
}
