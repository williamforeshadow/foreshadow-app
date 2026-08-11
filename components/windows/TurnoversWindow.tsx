'use client';

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import TurnoverCards from '@/components/TurnoverCards';
import { useTurnovers } from '@/lib/useTurnovers';
import { TurnoverFilterBar } from './turnovers';
import { ReservationContextPanel } from '@/components/reservations/ReservationContextPanel';
import type { ReservationContextTask } from '@/components/reservations/useReservationContext';
import {
  PropertyTaskDetailOverlay,
  type OverlayTaskInput,
} from '@/components/properties/tasks/PropertyTaskDetailOverlay';
import type { Turnover, User } from '@/lib/types';
import { DESKTOP_DETAIL_PANEL_FLEX } from '@/lib/detailPanelGeometry';
import { useExclusiveDetailPanelHost } from '@/lib/reservationViewerContext';
import { taskPath } from '@/src/lib/links';

// Turnovers window. Two-pane layout:
//   - Left: filterable + sortable list of turnover cards (one per active /
//     upcoming reservation), powered by the get_property_turnovers RPC.
//   - Right: the shared ReservationContextPanel (same panel as the messages
//     right rail, Schedule tab, and the global reservation viewer). It
//     self-fetches via /api/reservations/[id]/with-window-tasks — a card's
//     `id` IS its reservation id — and applies the same minute-precise
//     turnover-window task filter as the RPC, so the card progress bar and
//     the panel's task list agree.
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

function TurnoversWindowContent(props: TurnoversWindowProps) {
  void props;
  const router = useRouter();
  const {
    response,
    error,
    loading,
    filters,
    setFilterValues,
    setSearch,
    clearAllFilters,
    getActiveFilterCount,
    selectedCard,
    setSelectedCard,
    closeSelectedCard,
    fetchTurnovers,
    rightPanelRef,
    scrollPositionRef,
  } = useTurnovers();

  // Unique property names from the cards response, sorted A→Z, fed to the
  // Property MultiSelect chip. Derived (not fetched) so the option set is
  // exactly the properties present in the current data.
  const propertyOptions = useMemo(() => {
    const set = new Set<string>();
    if (Array.isArray(response)) {
      for (const card of response) {
        if (card.property_name) set.add(card.property_name);
      }
    }
    return Array.from(set)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ value: name, label: name }));
  }, [response]);

  // One detail layer at a time. selectedTask, when set, takes precedence and
  // hides the reservation panel beneath.
  const [selectedTask, setSelectedTask] = useState<OverlayTaskInput | null>(null);
  // Bumped after any task mutation so the reservation panel's associated-task
  // list re-fetches (its data lives in the reservation-window-tasks query,
  // separate from the turnovers RPC that feeds the cards).
  const [tasksRefreshKey, setTasksRefreshKey] = useState(0);

  // Strict single-panel rule: when any global detail panel (reservation
  // overlay or context task overlay) opens, close every local panel here.
  const closeGlobals = useExclusiveDetailPanelHost(() => {
    closeSelectedCard();
    setSelectedTask(null);
  });

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

  // ReservationContextTask is a structural superset of OverlayTaskInput, so
  // the panel's tasks hand straight to the standard task overlay — same as
  // the messages surface.
  const handleOpenTask = useCallback(
    (task: ReservationContextTask) => {
      closeGlobals();
      setSelectedTask(task);
    },
    [closeGlobals]
  );

  return (
    <div className="relative h-full overflow-hidden bg-white dark:bg-card flex flex-col">
      {/* Header region — EXPERIMENT: the gradient fades to transparent over
          the content background (bg-white / dark:bg-card as the base layer),
          so by the bottom edge it's exactly the body color and the header
          blends seamlessly into the cards below (no hairline divider). */}
      <div className="flex-shrink-0 bg-white dark:bg-card bg-[linear-gradient(to_bottom,var(--header-scrim),transparent)] border-b border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)]">
        <div className="pb-1 pl-8 pr-12 pt-6">
          <h1 className="text-[24px] font-semibold tracking-tight text-neutral-900 dark:text-[#f0efed]">
            Reservations
          </h1>
        </div>
        {response !== null && (
          <div className="px-8 pb-4">
            <TurnoverFilterBar
              filters={filters}
              setFilterValues={setFilterValues}
              setSearch={setSearch}
              clearAllFilters={clearAllFilters}
              getActiveFilterCount={getActiveFilterCount}
              propertyOptions={propertyOptions}
            />
          </div>
        )}
      </div>

      {/* Cards — scrollable body below the fixed header. */}
      <div className="flex-1 overflow-y-auto hide-scrollbar px-6 pb-6 pt-4">

        {response !== null && (
          <TurnoverCards
            data={Array.isArray(response) ? response : [response]}
            filters={filters}
            onCardClick={(card: Turnover) => {
              closeGlobals();
              setSelectedTask(null);
              setSelectedCard(card);
            }}
          />
        )}

        {loading && (
          <div className="flex justify-center items-center py-20">
            <p className="text-neutral-500 dark:text-neutral-400">
              Loading reservations...
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
              No reservations found
            </p>
          </div>
        )}
      </div>

      {/* Right Panel — the shared reservation context panel (messages rail /
          Schedule tab / global viewer). Absolute right-side overlay (shared
          geometry); hidden while a task overlay is open so we never stack
          two detail layers. The header title mirrors the card: owner stays
          read "Owner Stay" (the endpoint doesn't ship `kind`). */}
      {selectedCard && !selectedTask && (
        <div
          ref={rightPanelRef}
          className={DESKTOP_DETAIL_PANEL_FLEX}
          onScroll={(e) => {
            scrollPositionRef.current = (
              e.currentTarget as HTMLDivElement
            ).scrollTop;
          }}
        >
          <ReservationContextPanel
            reservationId={selectedCard.id}
            header={{
              title:
                selectedCard.kind === 'owner_stay'
                  ? 'Owner Stay'
                  : selectedCard.guest_name || 'Unnamed guest',
              onClose: closeSelectedCard,
            }}
            onOpenTask={handleOpenTask}
            tasksRefreshKey={tasksRefreshKey}
          />
        </div>
      )}

      {/* Task detail overlay — shared with Schedule / Tasks / Bins. Anchors
          to the relative wrapper above. Mutations inside refetch the
          turnovers RPC (card progress bar) and bump the panel's task list. */}
      <PropertyTaskDetailOverlay
        task={selectedTask}
        onClose={() => setSelectedTask(null)}
        onTaskUpdated={() => {
          fetchTurnovers();
          setTasksRefreshKey((k) => k + 1);
        }}
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
