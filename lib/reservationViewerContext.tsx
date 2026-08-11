'use client';

import React, {
  createContext,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { OverlayTaskInput } from '@/components/properties/tasks/PropertyTaskDetailOverlay';
import { taskPath } from '@/src/lib/links';

// Reservation Viewer
// ------------------
// App-wide hook that lets any clickable affordance (notably the key icon
// rendered next to reservation-bound task titles) request the shared
// reservation panel for a given reservation_id without each surface having
// to wire its own state. Data fetching lives in the panel itself
// (ReservationContextPanel → useReservationContext, a react-query cache
// keyed by reservation id); this provider only owns the open/close +
// "task-overlay-on-top" state so surface-level <ReservationDetailOverlay>
// instances are pure render-from-context.
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
  /** The id the overlay is currently showing (null when closed). */
  modalReservationId: string | null;

  // Task overlay state. When a row inside the reservation panel is clicked
  // we capture the converted overlay input here; the surface's <PropertyTaskDetailOverlay>
  // reads it and stacks above the reservation panel.
  selectedTask: OverlayTaskInput | null;
  setSelectedTask: (task: OverlayTaskInput | null) => void;
}

// Exported so the isolated, fully-mocked marketing demo (app/demo/*) can supply
// a no-op value to the real Schedule component. Inert for existing importers.
export const ReservationViewerContext = createContext<
  ReservationViewerContextValue | undefined
>(undefined);

export const NOOP_VALUE: ReservationViewerContextValue = {
  open: () => {},
  close: () => {},
  currentReservationId: null,
  modalReservationId: null,
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
  // NOTE: modalReservationId flips to null both when the panel is dismissed
  // *and* when a task row inside the panel is clicked (the swap below clears
  // the reservation as part of opening the task). selectedTask is owned by:
  //   - open(rid):                  clears it before opening
  //   - setSelectedTaskExclusive:   sets/clears it directly
  //   - the task overlay's onClose: clears it via setSelectedTask(null)
  const setSelectedTaskExclusive = useCallback(
    (task: OverlayTaskInput | null) => {
      if (task) setModalReservationId(null);
      setSelectedTask(task);
    },
    []
  );

  const value = useMemo<ReservationViewerContextValue>(
    () => ({
      open,
      close,
      // At provider level, currentReservationId tracks the active overlay's
      // target. Inline panels override this for their own subtree.
      currentReservationId: modalReservationId,
      modalReservationId,
      selectedTask,
      setSelectedTask: setSelectedTaskExclusive,
    }),
    [
      open,
      close,
      modalReservationId,
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

// ---- Legacy ?task=<uuid> redirect ------------------------------------
//
// Auto-upgrades old URLs to the canonical /tasks/<uuid> route. Slack
// messages emitted by the agent before the dedicated route existed
// embed `/?view=tasks&task=<uuid>`; rather than re-implementing the
// fetch-and-overlay machinery for them on the dashboard, we redirect
// straight to the new route — same destination as the agent emits
// today for fresh links.
//
// router.replace (not push) so refresh / back doesn't bounce the user
// through the empty-dashboard intermediary. UUID validation is light:
// we accept anything that looks UUID-shaped, since /tasks/<id> itself
// renders 404 via getTaskById's own validation if the id is bogus.
//
// Lives in its own component (rather than inline in the provider body)
// because useSearchParams() requires a <Suspense> boundary in Next 16's
// static-prerender pipeline. Splitting it out lets the provider stay
// universally mountable while keeping the URL-sensitive bits behind the
// boundary.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function TaskDeepLinkSync() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const taskParam = searchParams?.get('task') ?? null;

  useEffect(() => {
    if (!taskParam) return;
    if (!UUID_RE.test(taskParam)) return;
    router.replace(taskPath(taskParam) as never);
  }, [taskParam, router]);

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
