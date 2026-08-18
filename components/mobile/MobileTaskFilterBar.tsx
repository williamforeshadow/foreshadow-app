'use client';

import React, { useState } from 'react';
import type {
  FilterOption,
  SortKey,
  SortDir,
  DateRange,
} from '@/components/tasks/TaskFilterBar';
import { CompactSearch } from '@/components/ui/compact-search';
import {
  FilterPicker,
  SortPicker,
  SORT_KEY_LABELS,
} from '@/components/tasks/TaskPickers';

// Mobile-native filter/sort bar for the task list surfaces.
//
// Why this exists separately from the shared (desktop) `TaskFilterBar`:
//   - The desktop bar lays out 8+ filter chips + sort + search in a row,
//     which doesn't fit on a phone. This component collapses everything into
//     a single compact row (search + Filter button + Sort button + New task).
//
// The pickers themselves are the shared FilterPicker / SortPicker from
// TaskPickers — the standard drawer on mobile, the matching popover on
// desktop — so this bar only owns the trigger buttons and the row layout.
//
// All state stays owned by the parent (same controlled-component pattern
// as `TaskFilterBar`). The data shapes are 1:1 with `useTasks` outputs.

interface Props {
  // Search is always present.
  search: string;
  onSearchChange: (v: string) => void;

  // Every filter axis is optional — only render the chip when both the
  // options and the change handler are passed. Mirrors the desktop
  // TaskFilterBar contract so Schedule / Bins / Assignments can omit
  // axes that don't apply.
  statusOptions?: FilterOption[];
  statusSelected?: Set<string>;
  onStatusChange?: (next: Set<string>) => void;

  assigneeOptions?: FilterOption[];
  assigneeSelected?: Set<string>;
  onAssigneeChange?: (next: Set<string>) => void;

  departmentOptions?: FilterOption[];
  departmentSelected?: Set<string>;
  onDepartmentChange?: (next: Set<string>) => void;

  binOptions?: FilterOption[];
  binSelected?: Set<string>;
  onBinChange?: (next: Set<string>) => void;

  originOptions?: FilterOption[];
  originSelected?: Set<string>;
  onOriginChange?: (next: Set<string>) => void;

  priorityOptions?: FilterOption[];
  prioritySelected?: Set<string>;
  onPriorityChange?: (next: Set<string>) => void;

  propertyOptions?: FilterOption[];
  propertySelected?: Set<string>;
  onPropertyChange?: (next: Set<string>) => void;

  scheduledDateRange?: DateRange;
  onScheduledDateRangeChange?: (next: DateRange) => void;

  // Sort pill renders only when all three are present.
  sortKey?: SortKey;
  sortDir?: SortDir;
  onSortChange?: (k: SortKey, d: SortDir) => void;

  onClearAll: () => void;
  anyFilterActive: boolean;

  onNewTask?: () => void;

  // Controls rendered INSIDE the swipeable lane, after the Filter/Sort
  // pills — they scroll together with search/filter. Used by the Bins view
  // for its Boards + Columns pills so search can expand without crowding.
  laneControls?: React.ReactNode;

  // Pinned controls rendered immediately to the right of the swipeable
  // search/filter lane (clustered next to it). Stay fixed while the lane
  // scrolls. Used by the Schedule view for its < Today > date-nav pill.
  extraControls?: React.ReactNode;

  // Right-anchored controls rendered just before the New task button (e.g.
  // Schedule's Week/Month toggle). Share the far-right cluster with + task.
  trailingControls?: React.ReactNode;

  totalCount: number;
  filteredCount: number;
}

export function MobileTaskFilterBar(props: Props) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  const sortEnabled =
    !!props.sortKey && !!props.sortDir && !!props.onSortChange;

  return (
    <div className="flex items-center gap-2 px-4 pt-2 pb-3 flex-nowrap min-w-0">
      {/* Swipeable carousel lane. `min-w-0` + default flex-shrink (no
          flex-1) lets it size to its content and shrink/scroll when space
          is tight, so it never stretches full-width and pushes the trailing
          controls apart. `overflow-x-auto` makes the overflow swipe within
          the lane; `overscroll-x-contain` stops the scroll chaining to the
          page; `hide-scrollbar` hides the bar. */}
      <div className="flex items-center gap-2 flex-nowrap min-w-0 overflow-x-auto overscroll-x-contain hide-scrollbar">
        <div className="flex-shrink-0 flex items-center">
          <CompactSearch
            value={props.search}
            onChange={props.onSearchChange}
            placeholder="Search…"
          />
        </div>

        {/* Filter — icon-only (matches the search icon). Funnel turns accent
            when filters are active; a small badge shows the count. The
            picker opens from the button via FilterPicker's trigger wiring. */}
        <FilterPicker
          open={filterOpen}
          onOpenChange={setFilterOpen}
          renderTrigger={(activeCount) => (
            <button
              aria-label="Filter"
              className={`relative flex-shrink-0 p-1.5 rounded transition-colors ${
                activeCount > 0
                  ? 'bg-[var(--accent-bg-soft)] dark:bg-[var(--accent-bg-soft-dark)] text-[var(--accent-3)] dark:text-[var(--accent-1)]'
                  : 'text-[#9a9892] dark:text-[#66645f] active:bg-[rgba(30,25,20,0.04)] dark:active:bg-[rgba(255,255,255,0.04)]'
              }`}
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L15 12.414V19a1 1 0 01-.553.894l-4 2A1 1 0 019 21v-8.586L3.293 6.707A1 1 0 013 6V4z"
                />
              </svg>
              {activeCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center min-w-[15px] h-[15px] rounded-full bg-[var(--accent-3)] dark:bg-[var(--accent-2)] text-white dark:text-[#1a1a1a] text-[9px] font-semibold tabular-nums px-1">
                  {activeCount}
                </span>
              )}
            </button>
          )}
          onClearAll={props.onClearAll}
          statusOptions={props.statusOptions}
          statusSelected={props.statusSelected}
          onStatusChange={props.onStatusChange}
          assigneeOptions={props.assigneeOptions}
          assigneeSelected={props.assigneeSelected}
          onAssigneeChange={props.onAssigneeChange}
          departmentOptions={props.departmentOptions}
          departmentSelected={props.departmentSelected}
          onDepartmentChange={props.onDepartmentChange}
          binOptions={props.binOptions}
          binSelected={props.binSelected}
          onBinChange={props.onBinChange}
          originOptions={props.originOptions}
          originSelected={props.originSelected}
          onOriginChange={props.onOriginChange}
          priorityOptions={props.priorityOptions}
          prioritySelected={props.prioritySelected}
          onPriorityChange={props.onPriorityChange}
          propertyOptions={props.propertyOptions}
          propertySelected={props.propertySelected}
          onPropertyChange={props.onPropertyChange}
          scheduledDateRange={props.scheduledDateRange}
          onScheduledDateRangeChange={props.onScheduledDateRangeChange}
        />

        {sortEnabled && (
          <SortPicker
            open={sortOpen}
            onOpenChange={setSortOpen}
            sortKey={props.sortKey!}
            sortDir={props.sortDir!}
            onChange={props.onSortChange!}
            trigger={
              <button className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium border bg-transparent text-neutral-600 dark:text-[#a09e9a] border-neutral-200 dark:border-[rgba(255,255,255,0.08)]">
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 4h13M3 8h9M3 12h5M17 4v16m0 0l-4-4m4 4l4-4"
                  />
                </svg>
                <span className="text-neutral-400 dark:text-[#66645f]">Sort:</span>
                <span>{SORT_KEY_LABELS[props.sortKey!]}</span>
                <span className="text-neutral-400 dark:text-[#66645f]">
                  {props.sortDir === 'asc' ? '↑' : '↓'}
                </span>
              </button>
            }
          />
        )}

        {props.laneControls}
      </div>

      {/* Pinned controls immediately right of the lane (e.g. Schedule's
          < Today > nav), clustered next to the search/filter. */}
      {props.extraControls}

      {/* Right-anchored cluster: optional trailing controls (e.g. Schedule's
          Week/Month pill) + the New task button. ml-auto pushes them to the
          far right while the lane + extraControls stay clustered left. */}
      {(props.trailingControls || props.onNewTask) && (
        <div className="ml-auto flex items-center gap-2 flex-shrink-0">
          {props.trailingControls}
          {props.onNewTask && (
            <button
              onClick={props.onNewTask}
              className="flex-shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full bg-[var(--accent-3)] text-white hover:bg-[var(--accent-4)] dark:bg-[var(--accent-2)] dark:hover:bg-[var(--accent-1)] dark:text-[#1a1a1a] transition-colors"
              aria-label="New task"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
