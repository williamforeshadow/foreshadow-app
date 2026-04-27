'use client';

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
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
import type { Turnover, User } from '@/lib/types';

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

interface TurnoversWindowProps {
  users: User[];
  currentUser: User | null;
}

// Open-ended window when next_check_in is null. Bounded so we don't pull the
// entire forever-tail of recurring tasks. 365d matches a "year ahead" mental
// model and is plenty for a reservation that may end up extending.
const FALLBACK_WINDOW_DAYS = 365;

function addDays(yyyyMmDd: string, days: number): string {
  const slice = yyyyMmDd.length >= 10 ? yyyyMmDd.slice(0, 10) : yyyyMmDd;
  const d = new Date(`${slice}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
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

function TurnoversWindowContent(_: TurnoversWindowProps) {
  const {
    response,
    error,
    loading,
    viewMode,
    setViewMode,
    filters,
    sortBy,
    toggleFilter,
    clearAllFilters,
    getActiveFilterCount,
    selectedCard,
    setSelectedCard,
    closeSelectedCard,
    rightPanelRef,
    scrollPositionRef,
  } = useTurnovers();

  // Tasks scheduled inside the selected reservation's turnover window. The
  // RPC's per-card task list is reservation-bound (FK association); the new
  // "associated tasks" rule is purely scheduled-date-in-window, so we hydrate
  // from the dedicated endpoint each time a card is selected.
  const [windowTasks, setWindowTasks] = useState<ScheduleTask[]>([]);
  const [windowPropertyId, setWindowPropertyId] = useState<string | null>(null);

  // One detail layer at a time. selectedTask, when set, takes precedence and
  // hides the reservation panel beneath.
  const [selectedTask, setSelectedTask] = useState<OverlayTaskInput | null>(null);

  const fetchWindowTasks = useCallback(async () => {
    if (!selectedCard?.property_name || !selectedCard.check_in) {
      setWindowTasks([]);
      setWindowPropertyId(null);
      return;
    }
    const start = selectedCard.check_in.slice(0, 10);
    const end = selectedCard.next_check_in
      ? selectedCard.next_check_in.slice(0, 10)
      : addDays(start, FALLBACK_WINDOW_DAYS);
    try {
      const params = new URLSearchParams({
        property_name: selectedCard.property_name,
        start,
        end,
      });
      const res = await fetch(
        `/api/property-tasks-in-window?${params.toString()}`
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to load associated tasks');
      }
      setWindowTasks((data.tasks || []) as ScheduleTask[]);
      setWindowPropertyId(data.property?.id ?? null);
    } catch (err) {
      console.error('[TurnoversWindow] window tasks fetch failed:', err);
      setWindowTasks([]);
    }
  }, [
    selectedCard?.id,
    selectedCard?.property_name,
    selectedCard?.check_in,
    selectedCard?.next_check_in,
  ]);

  useEffect(() => {
    if (selectedCard) {
      fetchWindowTasks();
    } else {
      setWindowTasks([]);
      setWindowPropertyId(null);
      setSelectedTask(null);
    }
    // fetchWindowTasks captures the relevant card fields already
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCard?.id]);

  const handleOpenTask = useCallback(
    (task: ScheduleTask) => {
      setSelectedTask(
        scheduleTaskToOverlay(
          task,
          windowPropertyId,
          selectedCard?.property_name ?? null
        )
      );
    },
    [windowPropertyId, selectedCard?.property_name]
  );

  const reservationForPanel = useMemo(
    () => (selectedCard ? reservationFromTurnover(selectedCard) : null),
    [selectedCard]
  );

  return (
    <div className="relative flex h-full overflow-hidden glass-bg-neutral">
      {/* Left Panel — Cards */}
      <div
        className={`${
          selectedCard
            ? 'flex-1 min-w-0 border-r border-neutral-200/30 dark:border-white/10'
            : 'w-full'
        } overflow-y-auto hide-scrollbar p-6 space-y-4`}
      >
        {response !== null && (
          <div className="space-y-3">
            <TurnoverFilterBar
              filters={filters}
              toggleFilter={toggleFilter}
              clearAllFilters={clearAllFilters}
              getActiveFilterCount={getActiveFilterCount}
            />

            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Turnovers: {Array.isArray(response) ? response.length : 1} total
              </p>
              <div className="flex gap-1 p-1 rounded-xl bg-white/30 dark:bg-white/[0.06] backdrop-blur-sm border border-white/20 dark:border-white/10">
                <button
                  onClick={() => setViewMode('cards')}
                  className={`px-3 py-1 text-xs font-medium rounded-lg transition-all duration-200 ${
                    viewMode === 'cards'
                      ? 'bg-white/70 dark:bg-white/15 text-neutral-900 dark:text-white shadow-sm'
                      : 'text-neutral-500 dark:text-neutral-400 hover:bg-white/30 dark:hover:bg-white/10'
                  }`}
                >
                  Cards
                </button>
                <button
                  onClick={() => setViewMode('json')}
                  className={`px-3 py-1 text-xs font-medium rounded-lg transition-all duration-200 ${
                    viewMode === 'json'
                      ? 'bg-white/70 dark:bg-white/15 text-neutral-900 dark:text-white shadow-sm'
                      : 'text-neutral-500 dark:text-neutral-400 hover:bg-white/30 dark:hover:bg-white/10'
                  }`}
                >
                  JSON
                </button>
              </div>
            </div>

            <TurnoverCards
              data={Array.isArray(response) ? response : [response]}
              filters={filters}
              sortBy={sortBy}
              onCardClick={(card: Turnover) => {
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
          uses). Hidden while a task overlay is open so we never stack two
          detail layers. */}
      {selectedCard && reservationForPanel && !selectedTask && (
        <div
          ref={rightPanelRef}
          className="w-[30%] min-w-[320px] flex-shrink-0 h-full overflow-hidden border-l border-white/20 dark:border-white/10 bg-white dark:bg-[#0b0b0c]"
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
          to the relative wrapper above. Mutations inside refetch the window
          so the panel reflects edits when the user closes the overlay. */}
      <PropertyTaskDetailOverlay
        task={selectedTask}
        onClose={() => setSelectedTask(null)}
        onTaskUpdated={fetchWindowTasks}
      />
    </div>
  );
}

const TurnoversWindow = memo(TurnoversWindowContent);
export default TurnoversWindow;
