'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type {
  ScheduleReservation,
  ScheduleTask,
} from '@/components/properties/schedule/MonthGrid';
import type { OverlayTaskInput } from '@/components/properties/tasks/PropertyTaskDetailOverlay';

// Reservation Viewer
// ------------------
// App-wide hook that lets any clickable affordance (notably the key icon
// rendered next to reservation-bound task titles) request the
// ReservationDetailPanel for a given reservation_id without each surface
// having to wire its own state. The provider also owns the fetch + the
// "task-overlay-on-top" state so that surface-level <ReservationDetailOverlay>
// instances are pure render-from-context — no per-surface duplication of
// loading or refetching logic.
//
// Mounting model
// --------------
// Provider is mounted once at app/layout.tsx (root). Each app shell
// (DesktopApp, MobileApp, /properties layout) renders one
// <ReservationDetailOverlay/> inside its `relative` content area; the
// overlay reads everything below from context. Only the active route's
// shell is mounted, so there is exactly one visible overlay at a time.
//
// "Already in this reservation" suppression
// -----------------------------------------
// Surfaces that render the reservation panel inline (e.g. the
// PropertyScheduleView right rail when a purple block is clicked) wrap
// their inline panel content with <ReservationContextOverride
// id={reservation.id}>. KeyAffordance instances inside read
// `currentReservationId === item.reservation_id` and render a static
// badge instead of a clickable button — clicking would re-open the same
// reservation that's already on screen.

export interface ReservationDetailData {
  reservation: ScheduleReservation & {
    property_id?: string | null;
    property_name?: string | null;
  };
  tasks: ScheduleTask[];
  window: { start: string; end: string };
}

interface ReservationViewerContextValue {
  open: (reservationId: string) => void;
  close: () => void;
  /**
   * The reservation_id whose panel is currently considered "in view" at this
   * point in the React tree. Set either by the open overlay (when active) or
   * by an inline <ReservationContextOverride>. Used by KeyAffordance to
   * suppress click + hover affordances when it would re-open the same
   * reservation it already lives inside.
   */
  currentReservationId: string | null;
  /** The id the overlay is currently fetching/showing (null when closed). */
  modalReservationId: string | null;

  // Data state — owned by the provider so multiple overlay mounts (or none)
  // don't duplicate fetches.
  data: ReservationDetailData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;

  // Task overlay state. When a row inside the reservation panel is clicked
  // we capture the converted overlay input here; the surface's <PropertyTaskDetailOverlay>
  // reads it and stacks above the reservation panel.
  selectedTask: OverlayTaskInput | null;
  setSelectedTask: (task: OverlayTaskInput | null) => void;
}

const ReservationViewerContext = createContext<
  ReservationViewerContextValue | undefined
>(undefined);

const NOOP_VALUE: ReservationViewerContextValue = {
  open: () => {},
  close: () => {},
  currentReservationId: null,
  modalReservationId: null,
  data: null,
  loading: false,
  error: null,
  refetch: () => {},
  selectedTask: null,
  setSelectedTask: () => {},
};

export function useReservationViewer(): ReservationViewerContextValue {
  const ctx = useContext(ReservationViewerContext);
  // Defensive default — surfaces rendered outside the provider (e.g. tests
  // or storybook stubs) get a no-op viewer instead of crashing.
  return ctx ?? NOOP_VALUE;
}

export function ReservationViewerProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [modalReservationId, setModalReservationId] = useState<string | null>(
    null
  );
  const [data, setData] = useState<ReservationDetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<OverlayTaskInput | null>(
    null
  );

  // Strict mutual exclusion: opening a reservation closes any task overlay,
  // and opening a task closes any reservation overlay. Only one global
  // detail panel is ever rendered. Surface-local detail panels are closed
  // by the useEffect listener inside `useExclusiveDetailPanelHost` (see
  // hook below).
  const open = useCallback((reservationId: string) => {
    setSelectedTask(null);
    setModalReservationId(reservationId);
  }, []);
  const close = useCallback(() => {
    setModalReservationId(null);
  }, []);
  const setSelectedTaskExclusive = useCallback(
    (task: OverlayTaskInput | null) => {
      if (task) setModalReservationId(null);
      setSelectedTask(task);
    },
    []
  );

  // Fetch when the target id changes; reset server-fetched state on close.
  // NOTE: Do not clear `selectedTask` here. modalReservationId flips to null
  // both when the panel is dismissed *and* when a task row inside the panel
  // is clicked (setSelectedTaskExclusive clears the reservation as part of
  // the swap). Clobbering selectedTask in this effect would break the
  // reservation → task transition. selectedTask is owned by:
  //   - open(rid):                  clears it before opening
  //   - setSelectedTaskExclusive:   sets/clears it directly
  //   - the task overlay's onClose: clears it via setSelectedTask(null)
  useEffect(() => {
    if (!modalReservationId) {
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/reservations/${modalReservationId}/with-window-tasks`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok)
          throw new Error(body?.error || 'Failed to load reservation');
        return body as ReservationDetailData;
      })
      .then((body) => {
        if (cancelled) return;
        setData(body);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || 'Failed to load reservation');
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [modalReservationId]);

  const refetch = useCallback(() => {
    if (!modalReservationId) return;
    fetch(`/api/reservations/${modalReservationId}/with-window-tasks`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error || 'Failed to refetch');
        return body as ReservationDetailData;
      })
      .then(setData)
      .catch((err) =>
        console.error('[ReservationViewer] refetch failed:', err)
      );
  }, [modalReservationId]);

  const value = useMemo<ReservationViewerContextValue>(
    () => ({
      open,
      close,
      // At provider level, currentReservationId tracks the active overlay's
      // target. Inline panels override this for their own subtree.
      currentReservationId: modalReservationId,
      modalReservationId,
      data,
      loading,
      error,
      refetch,
      selectedTask,
      setSelectedTask: setSelectedTaskExclusive,
    }),
    [
      open,
      close,
      modalReservationId,
      data,
      loading,
      error,
      refetch,
      selectedTask,
      setSelectedTaskExclusive,
    ]
  );

  return (
    <ReservationViewerContext.Provider value={value}>
      {children}
    </ReservationViewerContext.Provider>
  );
}

/**
 * Surfaces (PropertyScheduleView, TimelineWindow, MyAssignmentsWindow,
 * TasksWindow, ProjectsWindow, TurnoversWindow, etc.) each own their own
 * local detail-panel state (e.g. `selectedTask`, `selectedDay`). Strict
 * mutual exclusion requires that opening a *global* detail panel
 * (reservation panel via key click, or context-owned task overlay) closes
 * any surface-local panels.
 *
 * Surfaces call this hook with a single `closeLocal` callback. Whenever
 * the global context opens any panel, the callback fires once.
 */
export function useExclusiveDetailPanelHost(closeLocal: () => void) {
  const { modalReservationId, selectedTask } = useReservationViewer();
  const closeRef = React.useRef(closeLocal);
  closeRef.current = closeLocal;
  useEffect(() => {
    if (modalReservationId || selectedTask) {
      closeRef.current();
    }
  }, [modalReservationId, selectedTask]);
}

/**
 * Wraps a subtree to declare "this part of the UI is already showing the
 * reservation panel for `id`". KeyAffordance instances inside compare against
 * this id and render a static badge instead of a clickable button when they
 * match.
 *
 * Inherits open/close + data state from the nearest ancestor provider so
 * callers inside an override (e.g. a task overlay launched from within an
 * inline panel) can still open *other* reservations normally.
 */
export function ReservationContextOverride({
  id,
  children,
}: {
  id: string | null;
  children: React.ReactNode;
}) {
  const parent = useContext(ReservationViewerContext);
  const value = useMemo<ReservationViewerContextValue>(
    () => ({
      ...(parent ?? NOOP_VALUE),
      currentReservationId: id,
    }),
    [parent, id]
  );

  return (
    <ReservationViewerContext.Provider value={value}>
      {children}
    </ReservationViewerContext.Provider>
  );
}
