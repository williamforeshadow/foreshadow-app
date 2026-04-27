'use client';

import React, { useEffect } from 'react';
import { useReservationViewer } from '@/lib/reservationViewerContext';
import { useIsMobile } from '@/lib/useIsMobile';
import { ReservationDetailPanel } from '@/components/properties/schedule/ReservationDetailPanel';
import type { ScheduleTask } from '@/components/properties/schedule/MonthGrid';
import type { OverlayTaskInput } from '@/components/properties/tasks/PropertyTaskDetailOverlay';
import { DESKTOP_DETAIL_PANEL_FLEX } from '@/lib/detailPanelGeometry';

// Per-surface reservation overlay
// -------------------------------
// Drop one instance inside each app shell's `relative` content area
// (DesktopApp, MobileApp, /properties layout). Reads everything from
// ReservationViewerProvider so the same fetch is shared across mounts;
// only the visible shell's instance ever appears.
//
// Geometry contract:
//   - Desktop: DESKTOP_DETAIL_PANEL_CLASS — `absolute inset-y-0 right-0 w-1/3`
//     of the host's relative parent. Identical to PropertyTaskDetailOverlay
//     so the two panels swap into the same slot.
//   - Mobile: full-sheet `fixed inset-0` (panels' standard mobile idiom).
//   - No backdrop. Closing is via the panel's own X button or Esc.
//
// Strict mutual exclusion: clicking a task row inside this panel writes to
// context's selectedTask, and the provider clears modalReservationId in
// the same action — so this overlay unmounts and <ContextTaskDetailOverlay/>
// (mounted as a sibling at every surface anchor) takes over the slot.

function scheduleTaskToOverlay(
  task: ScheduleTask,
  fallbackPropertyId: string | null,
  fallbackPropertyName: string | null
): OverlayTaskInput {
  return {
    task_id: task.task_id,
    reservation_id: task.reservation_id,
    property_id: task.property_id ?? fallbackPropertyId,
    property_name: task.property_name ?? fallbackPropertyName,
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
}

export function ReservationDetailOverlay() {
  const {
    modalReservationId,
    close,
    data,
    loading,
    error,
    setSelectedTask,
  } = useReservationViewer();
  const isMobile = useIsMobile();

  useEffect(() => {
    if (!modalReservationId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [modalReservationId, close]);

  if (!modalReservationId) return null;

  // Setting selectedTask atomically clears modalReservationId in the
  // provider, so this component will unmount on the next render and
  // <ContextTaskDetailOverlay/> takes the slot.
  const handleOpenTask = (task: ScheduleTask) => {
    setSelectedTask(
      scheduleTaskToOverlay(
        task,
        data?.reservation.property_id ?? null,
        data?.reservation.property_name ?? null
      )
    );
  };

  const body = (
    <>
      {loading && !data && (
        <div className="flex-1 flex items-center justify-center text-sm text-neutral-500 dark:text-[#a09e9a]">
          Loading…
        </div>
      )}
      {error && (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center">
          <div className="text-sm text-red-500">{error}</div>
          <button
            onClick={close}
            className="text-xs underline text-neutral-500 dark:text-[#a09e9a]"
          >
            Close
          </button>
        </div>
      )}
      {data && !error && (
        // ReservationDetailPanel wraps its own content in
        // <ReservationContextOverride id={reservation.id}>, so any task rows
        // inside render the key icon as a static (no-op) badge — clicking
        // would re-open the same reservation.
        <ReservationDetailPanel
          reservation={{
            id: data.reservation.id,
            guest_name: data.reservation.guest_name,
            check_in: data.reservation.check_in,
            check_out: data.reservation.check_out,
            next_check_in: data.reservation.next_check_in ?? null,
            property_name: data.reservation.property_name ?? undefined,
          }}
          allTasks={data.tasks}
          onClose={close}
          onOpenTask={handleOpenTask}
        />
      )}
    </>
  );

  if (isMobile) {
    return (
      <div className="fixed inset-0 z-[60] bg-white dark:bg-[#0b0b0c] flex flex-col overflow-hidden">
        {body}
      </div>
    );
  }

  return <div className={DESKTOP_DETAIL_PANEL_FLEX}>{body}</div>;
}
