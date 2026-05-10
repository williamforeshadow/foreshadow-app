'use client';

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import TurnoverCards from '@/components/TurnoverCards';
import { useTurnovers } from '@/lib/useTurnovers';
import { TurnoverFilterBar } from './turnovers';
import { ReservationDetailPanel } from '@/components/properties/schedule/ReservationDetailPanel';
import {
  PropertyTaskDetailOverlay,
  type OverlayTaskInput,
} from '@/components/properties/tasks/PropertyTaskDetailOverlay';
import type {
  ScheduleReservation,
  ScheduleTask,
} from '@/components/properties/schedule/MonthGrid';
import type { Task, Turnover, User } from '@/lib/types';
import { DESKTOP_DETAIL_PANEL_FLEX } from '@/lib/detailPanelGeometry';
import { useExclusiveDetailPanelHost } from '@/lib/reservationViewerContext';
import { taskPath } from '@/src/lib/links';

// Turnovers window. Two-pane layout:
//   - Left: filterable + sortable list of turnover cards (one per active /
//     upcoming reservation), powered by the get_property_turnovers RPC.
//   - Right: shared ReservationDetailPanel from the property Schedule tab —
//     same component, same "associated tasks" semantics. A task is associated
//     with a turnover purely by virtue of its scheduled_date falling inside
//     [check_in, next_check_in); rescheduling re-associates it naturally.
//
// Clicking a task inside the panel opens the shared PropertyTaskDetailOverlay
// (the same one Schedule / Bins / Tasks use), which owns all editing /
// comments / attachments / time-tracking plumbing internally. Only one detail
// layer is visible at a time — while a task overlay is open we hide the
// reservation panel, mirroring PropertyScheduleView.
//
// "Associated tasks" hydration: the RPC's per-card `tasks` array is already
// minute-precise filtered to [check_in @ defaultCheckInTime,
// next_check_in @ defaultCheckInTime), so we feed the panel from it directly
// instead of doing a separate window-scoped fetch. Net: one less HTTP hop per
// card click and the card progress bar + the panel's task list are guaranteed
// to come from the same source.

interface TurnoversWindowProps {
  users: User[];
  currentUser: User | null;
}

function reservationFromTurnover(
  card: Turnover
): (ScheduleReservation & { property_name?: string }) | null {
  if (!card.check_in || !card.check_out) return null;
  return {
    id: card.id,
    guest_name: card.guest_name || null,
    check_in: card.check_in.slice(0, 10),
    check_out: card.check_out.slice(0, 10),
    next_check_in: card.next_check_in ? card.next_check_in.slice(0, 10) : null,
    property_name: card.property_name,
  };
}

// Adapter: RPC `Task` (jsonb_agg row from get_property_turnovers) → the
// `ScheduleTask` shape ReservationDetailPanel + PropertyTaskDetailOverlay
// consume. Most fields map 1:1; the few RPC omissions (property_id,
// bin_name, is_binned, created_at, updated_at) are non-essential for the
// panel surfaces — the overlay's mutation paths key on `task_id` and
// resolve property_name internally, so passing nulls is safe.
function turnoverTaskToScheduleTask(
  task: Task,
  fallbackPropertyName: string | null
): ScheduleTask {
  return {
    task_id: task.task_id,
    title: task.title ?? null,
    template_name: task.template_name ?? null,
    scheduled_date: task.scheduled_date ?? null,
    scheduled_time: task.scheduled_time ?? null,
    status: task.status,
    reservation_id: task.reservation_id ?? null,
    is_automated: task.template_id != null,
    assigned_users: (task.assigned_users || []).map((u) => ({
      user_id: u.user_id,
      name: u.name,
      avatar: u.avatar ?? null,
      role: u.role,
    })),
    property_id: null,
    property_name: task.property_name ?? fallbackPropertyName,
    template_id: task.template_id ?? null,
    description: task.description ?? null,
    priority: task.priority ?? undefined,
    department_id: task.department_id ?? null,
    department_name: task.department_name ?? null,
    form_metadata: task.form_metadata ?? null,
    bin_id: task.bin_id ?? null,
    bin_name: null,
    is_binned: !!task.is_binned,
  };
}

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

function TurnoversWindowContent(props: TurnoversWindowProps) {
  void props;
  const router = useRouter();
  const {
    response,
    error,
    loading,
    filters,
    toggleFilter,
    clearAllFilters,
    getActiveFilterCount,
    selectedCard,
    setSelectedCard,
    closeSelectedCard,
    fetchTurnovers,
    rightPanelRef,
    scrollPositionRef,
  } = useTurnovers();

  // One detail layer at a time. selectedTask, when set, takes precedence and
  // hides the reservation panel beneath.
  const [selectedTask, setSelectedTask] = useState<OverlayTaskInput | null>(null);

  // Strict single-panel rule: when any global detail panel (reservation
  // overlay or context task overlay) opens, close every local panel here.
  const closeGlobals = useExclusiveDetailPanelHost(() => {
    closeSelectedCard();
    setSelectedTask(null);
  });

  // Tasks for the selected card's reservation window. Sourced directly from
  // the RPC payload — `selectedCard.tasks` is already minute-precise filtered
  // and sorted by get_property_turnovers, so no second fetch is required.
  const windowTasks = useMemo<ScheduleTask[]>(() => {
    if (!selectedCard) return [];
    const fallbackPropertyName = selectedCard.property_name ?? null;
    return (selectedCard.tasks || []).map((t) =>
      turnoverTaskToScheduleTask(t, fallbackPropertyName)
    );
  }, [selectedCard]);

  // Clearing the card also tears down any open task overlay so we never
  // leave a stale right-pane behind.
  useEffect(() => {
    if (!selectedCard) {
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) {
          setSelectedTask(null);
        }
      });
      return () => {
        cancelled = true;
      };
    }
  }, [selectedCard]);

  const handleOpenTask = useCallback(
    (task: ScheduleTask) => {
      closeGlobals();
      setSelectedTask(
        scheduleTaskToOverlay(task, null, selectedCard?.property_name ?? null)
      );
    },
    [selectedCard?.property_name, closeGlobals]
  );

  const reservationForPanel = useMemo(
    () => (selectedCard ? reservationFromTurnover(selectedCard) : null),
    [selectedCard]
  );

  return (
    <div className="relative h-full overflow-hidden bg-white dark:bg-card">
      {/* Left Panel — Cards. Always full-width; the detail panel below
          floats over the right 1/3 (overlay) instead of compressing the
          list, matching every other detail panel in the app. */}
      <div className="w-full h-full overflow-y-auto hide-scrollbar p-6 space-y-4">

        {response !== null && (
          <div className="space-y-3">
            <TurnoverFilterBar
              filters={filters}
              toggleFilter={toggleFilter}
              clearAllFilters={clearAllFilters}
              getActiveFilterCount={getActiveFilterCount}
            />

            <TurnoverCards
              data={Array.isArray(response) ? response : [response]}
              filters={filters}
              onCardClick={(card: Turnover) => {
                closeGlobals();
                setSelectedTask(null);
                setSelectedCard(card);
              }}
            />
          </div>
        )}

        {loading && (
          <div className="flex justify-center items-center py-20">
            <p className="text-neutral-500 dark:text-neutral-400">
              Loading turnovers...
            </p>
          </div>
        )}

        {error && (
          <div className="flex justify-center items-center py-20">
            <p className="text-red-500">Error: {error}</p>
          </div>
        )}

        {!loading && !error && response === null && (
          <div className="flex justify-center items-center py-20">
            <p className="text-neutral-500 dark:text-neutral-400">
              No turnovers found
            </p>
          </div>
        )}
      </div>

      {/* Right Panel — Reservation detail (same component the Schedule tab
          uses). Absolute right-side overlay (shared geometry); hidden while
          a task overlay is open so we never stack two detail layers. */}
      {selectedCard && reservationForPanel && !selectedTask && (
        <div
          ref={rightPanelRef}
          className={DESKTOP_DETAIL_PANEL_FLEX}
          onScroll={(e) => {
            scrollPositionRef.current = (
              e.currentTarget as HTMLDivElement
            ).scrollTop;
          }}
        >
          <ReservationDetailPanel
            reservation={reservationForPanel}
            allTasks={windowTasks}
            onClose={closeSelectedCard}
            onOpenTask={handleOpenTask}
          />
        </div>
      )}

      {/* Task detail overlay — shared with Schedule / Tasks / Bins. Anchors
          to the relative wrapper above. Mutations inside refetch the
          turnovers RPC so both the card progress bar and the panel's task
          list reflect edits the moment the overlay closes. */}
      <PropertyTaskDetailOverlay
        task={selectedTask}
        onClose={() => setSelectedTask(null)}
        onTaskUpdated={fetchTurnovers}
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
    </div>
  );
}

const TurnoversWindow = memo(TurnoversWindowContent);
export default TurnoversWindow;
