'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useReservationViewer } from '@/lib/reservationViewerContext';
import { PropertyTaskDetailOverlay } from '@/components/properties/tasks/PropertyTaskDetailOverlay';
import { taskPath } from '@/src/lib/links';

// Per-surface task overlay driven by ReservationViewerProvider.
// ------------------------------------------------------------
// Mount one instance inside each app shell's `relative` content area
// (same anchors as <ReservationDetailOverlay/>). It reads only `selectedTask`
// from context — independent of the reservation panel — so a swap from
// reservation → task (and the reverse) renders cleanly without either
// ever stacking on top of the other.
//
// PropertyTaskDetailOverlay self-renders null when `task` is null, so this
// component is a no-op until something writes to context's selectedTask.
//
// onOpenInPage routes the user to the dedicated `/tasks/<uuid>` page (SSR'd,
// shareable URL, full app chrome). The overlay closes itself on click so we
// don't briefly render the dialog over the new route during the navigation.
export function ContextTaskDetailOverlay() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { selectedTask, setSelectedTask } = useReservationViewer();
  return (
    <PropertyTaskDetailOverlay
      task={selectedTask}
      onClose={() => setSelectedTask(null)}
      // The reservation panel's associated-task lists live in the
      // reservation-window-tasks react-query cache. Invalidate the whole
      // family after a mutation so any reservation panel re-opened next
      // shows the edit (we no longer know which reservation the task came
      // from — the swap already cleared modalReservationId).
      onTaskUpdated={() =>
        queryClient.invalidateQueries({ queryKey: ['reservation-window-tasks'] })
      }
      onOpenInPage={
        selectedTask
          ? () => {
              const id = selectedTask.task_id;
              setSelectedTask(null);
              router.push(taskPath(id));
            }
          : undefined
      }
    />
  );
}
