'use client';

import React, {
  createContext,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
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
      {/* Deep-link bridge lives inside the provider so it can read context.
          Wrapped in <Suspense> because it calls useSearchParams() — Next 16
          requires that for the static prerender bailout (e.g. /_not-found
          inherits the root layout, which mounts this provider). The bridge
          renders nothing visible; it's effects-only. */}
      <Suspense fallback={null}>
        <TaskDeepLinkSync />
      </Suspense>
      {children}
    </ReservationViewerContext.Provider>
  );
}

// ---- ?task=<uuid> deep-link plumbing ---------------------------------
//
// Lets the agent (Slack + in-app chat) link straight to a task overlay.
// The contract is one-way URL → overlay:
//   1. When ?task=<uuid> appears in the URL, fetch the row from
//      /api/all-tasks/[id] and call setSelectedTask on the context. The
//      overlay self-mounts via the surface's <ContextTaskDetailOverlay/>.
//   2. When the overlay closes (selectedTask flips to null) and the URL
//      still carries the param we opened, strip it so refresh / back
//      doesn't re-pop the panel and so URLs stay meaningful for sharing.
//   3. If the fetch fails (deleted task, bad uuid), clear the URL too —
//      a stale ?task=bogus would otherwise stick around forever.
//
// Surface-local task selection (e.g. clicking a row inside TasksWindow
// or MobileTasksView) does NOT go through the global context, so the
// URL stays clean for those gestures. Only the deep-link path uses it.
//
// Lives in its own component (rather than inline in the provider body)
// because useSearchParams() requires a <Suspense> boundary in Next 16's
// static-prerender pipeline. Splitting it out lets the provider stay
// universally mountable while keeping the URL-sensitive bits behind the
// boundary.
function TaskDeepLinkSync() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { selectedTask, setSelectedTask } = useReservationViewer();

  const taskParam = searchParams?.get('task') ?? null;
  // Tracks the param value we last reacted to. Prevents the clear-URL
  // effect from firing on params we didn't open ourselves, and lets us
  // no-op when the URL is already in sync with state.
  const lastHandledTaskParamRef = useRef<string | null>(null);

  const clearTaskParamFromUrl = useCallback(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('task')) return;
    params.delete('task');
    const qs = params.toString();
    const path = pathname || window.location.pathname;
    const href = qs ? `${path}?${qs}` : path;
    lastHandledTaskParamRef.current = null;
    router.replace(href as any, { scroll: false });
  }, [pathname, router]);

  // (1) URL → overlay. Fetch when a new task id appears.
  useEffect(() => {
    if (!taskParam) {
      lastHandledTaskParamRef.current = null;
      return;
    }
    // Already showing this exact task — nothing to do.
    if (selectedTask?.task_id === taskParam) {
      lastHandledTaskParamRef.current = taskParam;
      return;
    }
    let cancelled = false;
    lastHandledTaskParamRef.current = taskParam;
    fetch(`/api/all-tasks/${taskParam}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) {
          throw new Error(body?.error || 'task lookup failed');
        }
        return body as { data: OverlayTaskInput };
      })
      .then((body) => {
        if (cancelled) return;
        if (body?.data) {
          // setSelectedTask is exclusive (clears any open reservation
          // panel as part of the swap), so deep-linking can't
          // double-stack overlays.
          setSelectedTask(body.data);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[ReservationViewer] deep-link task fetch failed', {
          taskId: taskParam,
          err,
        });
        // (3) Strip the dud param so the URL doesn't carry it forever.
        clearTaskParamFromUrl();
      });
    return () => {
      cancelled = true;
    };
    // selectedTask intentionally omitted: re-running this effect when the
    // user closes the overlay would immediately re-open it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskParam, setSelectedTask, clearTaskParamFromUrl]);

  // (2) Overlay close → URL cleanup. When selectedTask drops to null but
  // the URL still has a task param we opened, strip it. Surface-local
  // filter params are rewritten by the owning view's own URL-sync
  // effects, so we only touch the `task` key here.
  useEffect(() => {
    if (selectedTask) return;
    if (!taskParam) return;
    if (lastHandledTaskParamRef.current !== taskParam) return;
    clearTaskParamFromUrl();
  }, [selectedTask, taskParam, clearTaskParamFromUrl]);

  return null;
}

/**
 * Surfaces (PropertyScheduleView, TimelineWindow, MyAssignmentsWindow,
 * TasksWindow, ProjectsWindow, TurnoversWindow, etc.) each own their own
 * local detail-panel state (e.g. `selectedTask`, `selectedDay`). Strict
 * mutual exclusion runs in *both* directions:
 *
 *   1. Global → Local: when the context opens a reservation or task
 *      overlay, the surface's `closeLocal()` callback fires once so its
 *      own panel state is reset. Wired by the useEffect below.
 *
 *   2. Local → Global: when the surface opens its *own* panel (in
 *      response to a user gesture), it must close any active context
 *      overlay first. Surfaces call the returned `closeGlobals()`
 *      callback at the click handler before flipping their own state:
 *
 *        const closeGlobals = useExclusiveDetailPanelHost(() => {
 *          setSelectedDay(null);
 *          setFloatingData(null);
 *        });
 *        ...
 *        onClick={() => { closeGlobals(); setSelectedDay(date); }}
 *
 * Without (2) the local panel mounts at the same `z-20` slot as the
 * still-open context overlay and gets hidden behind it — visible only
 * after the user manually dismisses the global panel.
 */
export function useExclusiveDetailPanelHost(closeLocal: () => void) {
  const { modalReservationId, selectedTask, close, setSelectedTask } =
    useReservationViewer();
  const closeRef = React.useRef(closeLocal);
  closeRef.current = closeLocal;
  useEffect(() => {
    if (modalReservationId || selectedTask) {
      closeRef.current();
    }
  }, [modalReservationId, selectedTask]);

  return useCallback(() => {
    close();
    setSelectedTask(null);
  }, [close, setSelectedTask]);
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
