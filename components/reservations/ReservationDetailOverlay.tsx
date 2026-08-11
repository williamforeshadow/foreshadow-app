'use client';

import React, { useEffect } from 'react';
import { useReservationViewer } from '@/lib/reservationViewerContext';
import { useIsMobile } from '@/lib/useIsMobile';
import { ReservationContextPanel } from '@/components/reservations/ReservationContextPanel';
import type { ReservationContextTask } from '@/components/reservations/useReservationContext';
import { DESKTOP_DETAIL_PANEL_FLEX } from '@/lib/detailPanelGeometry';

// Per-surface reservation overlay
// -------------------------------
// Drop one instance inside each app shell's `relative` content area
// (DesktopApp, MobileApp, /properties layout). Reads the target id from
// ReservationViewerProvider; the shared <ReservationContextPanel/> owns its
// own fetch (react-query keyed by reservation id), so multiple mounts share
// one cache entry and only the visible shell's instance ever appears.
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

export function ReservationDetailOverlay() {
  const { modalReservationId, close, setSelectedTask } = useReservationViewer();
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
  // <ContextTaskDetailOverlay/> takes the slot. ReservationContextTask is a
  // structural superset of the overlay's input, so it hands off as-is.
  const handleOpenTask = (task: ReservationContextTask) => {
    setSelectedTask(task);
  };

  const body = (
    <ReservationContextPanel
      reservationId={modalReservationId}
      header={{ onClose: close }}
      onOpenTask={handleOpenTask}
    />
  );

  if (isMobile) {
    return (
      <div className="fixed inset-0 z-[60] bg-white dark:bg-background safe-area-top flex flex-col overflow-hidden">
        {body}
      </div>
    );
  }

  return <div className={DESKTOP_DETAIL_PANEL_FLEX}>{body}</div>;
}
