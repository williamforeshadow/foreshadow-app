'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type {
  FilterOption,
  SortKey,
  SortDir,
  DateRange,
} from '@/components/tasks/TaskFilterBar';
import { CompactSearch } from '@/components/ui/compact-search';
import { TaskSheet, TaskOptionRow } from '@/components/tasks/detail/primitives/TaskSheet';

// Mobile-native filter/sort UX for the global Tasks ledger.
//
// Why this exists separately from the shared (desktop) `TaskFilterBar`:
//   - The desktop bar lays out 8+ filter chips + sort + search in a row,
//     which doesn't fit on a phone. Forcing it inside `overflow-x-auto`
//     produces a long horizontal scroll AND clips the chip popovers.
//   - This component collapses everything into a single compact row
//     (search + Filter button + Sort button + New task) and exposes the
//     full-fidelity filter UI inside bottom sheets.
//
// Both sheets are built on the standard TaskSheet drawer (the same one the
// task detail's status/priority badge pickers use) so every picker surface
// in the app shares one drawer language. The filter sheet is a two-level
// drill-in: a root list of axes, each pushing into its option list.
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

const SORT_KEY_LABELS: Record<SortKey, string> = {
  scheduled: 'Scheduled date',
  completed: 'Completed date',
  created: 'Created date',
  updated: 'Updated date',
  priority: 'Priority',
};

export function MobileTaskFilterBar(props: Props) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  // Active-filter chip count for the "Filter" button badge. Each axis only
  // contributes if it's actually wired (the consumer might omit it). Origin
  // counts only when exactly one of (manual / automated) is selected — both
  // selected is functionally "no filter" at the consumer's filter layer.
  const activeCount = useMemo(() => {
    let n = 0;
    n += props.statusSelected?.size ?? 0;
    n += props.assigneeSelected?.size ?? 0;
    n += props.departmentSelected?.size ?? 0;
    n += props.binSelected?.size ?? 0;
    if (props.originSelected && props.originSelected.size === 1) n += 1;
    n += props.prioritySelected?.size ?? 0;
    n += props.propertySelected?.size ?? 0;
    if (
      props.scheduledDateRange &&
      (props.scheduledDateRange.from || props.scheduledDateRange.to)
    )
      n += 1;
    return n;
  }, [
    props.statusSelected,
    props.assigneeSelected,
    props.departmentSelected,
    props.binSelected,
    props.originSelected,
    props.prioritySelected,
    props.propertySelected,
    props.scheduledDateRange,
  ]);

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
            when filters are active; a small badge shows the count. */}
        <button
          onClick={() => setFilterOpen(true)}
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

        {sortEnabled && (
          <button
            onClick={() => setSortOpen(true)}
            className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium border bg-transparent text-neutral-600 dark:text-[#a09e9a] border-neutral-200 dark:border-[rgba(255,255,255,0.08)]"
          >
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

      <FilterSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        activeCount={activeCount}
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
        <SortSheet
          open={sortOpen}
          onClose={() => setSortOpen(false)}
          sortKey={props.sortKey!}
          sortDir={props.sortDir!}
          onChange={props.onSortChange!}
        />
      )}
    </div>
  );
}

// ============================================================================
// Filter sheet — two-level drill-in on the standard TaskSheet drawer.
// Root view lists the wired axes; tapping one shows its option list with the
// same TaskOptionRow language as the task detail's badge pickers.
// ============================================================================

type SetAxisId =
  | 'status'
  | 'assignee'
  | 'department'
  | 'bin'
  | 'origin'
  | 'priority'
  | 'property';
type AxisView = 'root' | SetAxisId | 'dateRange';

interface SetAxis {
  id: SetAxisId;
  label: string;
  options: FilterOption[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  searchable?: boolean;
}

interface FilterSheetProps {
  open: boolean;
  onClose: () => void;
  activeCount: number;
  onClearAll: () => void;

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
}

function FilterSheet(props: FilterSheetProps) {
  const [view, setView] = useState<AxisView>('root');

  // Reset to the root list whenever the sheet closes, so reopening never
  // lands mid-drill-in.
  useEffect(() => {
    if (!props.open) setView('root');
  }, [props.open]);

  const axes: SetAxis[] = useMemo(() => {
    const out: SetAxis[] = [];
    if (props.statusOptions && props.statusSelected && props.onStatusChange)
      out.push({ id: 'status', label: 'Status', options: props.statusOptions, selected: props.statusSelected, onChange: props.onStatusChange });
    if (props.assigneeOptions && props.assigneeSelected && props.onAssigneeChange)
      out.push({ id: 'assignee', label: 'Assignee', options: props.assigneeOptions, selected: props.assigneeSelected, onChange: props.onAssigneeChange, searchable: true });
    if (props.departmentOptions && props.departmentSelected && props.onDepartmentChange)
      out.push({ id: 'department', label: 'Department', options: props.departmentOptions, selected: props.departmentSelected, onChange: props.onDepartmentChange });
    if (props.binOptions && props.binSelected && props.onBinChange)
      out.push({ id: 'bin', label: 'Bin', options: props.binOptions, selected: props.binSelected, onChange: props.onBinChange });
    if (props.originOptions && props.originSelected && props.onOriginChange)
      out.push({ id: 'origin', label: 'Origin', options: props.originOptions, selected: props.originSelected, onChange: props.onOriginChange });
    if (props.priorityOptions && props.prioritySelected && props.onPriorityChange)
      out.push({ id: 'priority', label: 'Priority', options: props.priorityOptions, selected: props.prioritySelected, onChange: props.onPriorityChange });
    if (props.propertyOptions && props.propertySelected && props.onPropertyChange)
      out.push({ id: 'property', label: 'Property', options: props.propertyOptions, selected: props.propertySelected, onChange: props.onPropertyChange, searchable: true });
    return out;
  }, [
    props.statusOptions, props.statusSelected, props.onStatusChange,
    props.assigneeOptions, props.assigneeSelected, props.onAssigneeChange,
    props.departmentOptions, props.departmentSelected, props.onDepartmentChange,
    props.binOptions, props.binSelected, props.onBinChange,
    props.originOptions, props.originSelected, props.onOriginChange,
    props.priorityOptions, props.prioritySelected, props.onPriorityChange,
    props.propertyOptions, props.propertySelected, props.onPropertyChange,
  ]);

  const hasDateRange = !!props.scheduledDateRange && !!props.onScheduledDateRangeChange;
  const activeAxis = view !== 'root' && view !== 'dateRange' ? axes.find((a) => a.id === view) : undefined;

  const title =
    view === 'root'
      ? props.activeCount > 0
        ? `Filters · ${props.activeCount}`
        : 'Filters'
      : view === 'dateRange'
        ? 'Scheduled date'
        : activeAxis?.label ?? 'Filters';

  const axisSummary = (axis: SetAxis): string => {
    if (axis.id === 'origin') {
      return axis.selected.size === 1
        ? axis.options.find((o) => axis.selected.has(o.value))?.label || ''
        : '';
    }
    return summarizeSet(axis.selected, axis.options);
  };

  return (
    <TaskSheet
      open={props.open}
      onOpenChange={(v) => {
        if (!v) props.onClose();
      }}
      title={title}
    >
      {view === 'root' ? (
        <div className="pb-1">
          {axes.map((axis) => (
            <AxisRow
              key={axis.id}
              label={axis.label}
              summary={axisSummary(axis)}
              onOpen={() => setView(axis.id)}
            />
          ))}
          {hasDateRange && (
            <AxisRow
              label="Scheduled date"
              summary={formatRangeSummary(props.scheduledDateRange!)}
              onOpen={() => setView('dateRange')}
            />
          )}
          {props.activeCount > 0 && (
            <>
              <div className="my-1.5 h-px" style={{ background: 'var(--task-line)' }} />
              <button
                type="button"
                onClick={props.onClearAll}
                className="flex w-full items-center rounded-lg px-2.5 text-left transition-colors min-h-[50px] active:bg-[var(--task-surface-2)] hover:bg-[var(--task-surface-2)]"
              >
                <span className="text-[15px]" style={{ color: 'var(--task-ink-3)' }}>
                  Clear all filters
                </span>
              </button>
            </>
          )}
        </div>
      ) : view === 'dateRange' ? (
        <div className="pb-1">
          <BackRow onBack={() => setView('root')} />
          <DateRangeFields
            range={props.scheduledDateRange!}
            onChange={props.onScheduledDateRangeChange!}
          />
        </div>
      ) : activeAxis ? (
        <AxisOptionList key={activeAxis.id} axis={activeAxis} onBack={() => setView('root')} />
      ) : null}
    </TaskSheet>
  );
}

// A root-level row: axis label, current selection summary in accent, chevron.
// Sized and surfaced identically to TaskOptionRow so both levels read as the
// same drawer.
function AxisRow({
  label,
  summary,
  onOpen,
}: {
  label: string;
  summary: string;
  onOpen: () => void;
}) {
  const active = !!summary;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-lg px-2.5 text-left transition-colors min-h-[50px] active:bg-[var(--task-surface-2)] hover:bg-[var(--task-surface-2)]"
    >
      <span
        className="text-[15px] shrink-0"
        style={{ color: active ? 'var(--task-ink-1)' : 'var(--task-ink-2)' }}
      >
        {label}
      </span>
      <span className="flex-1 min-w-0 text-right text-[13px] truncate text-[var(--accent-3)] dark:text-[var(--accent-1)]">
        {summary}
      </span>
      <svg
        className="w-4 h-4 shrink-0"
        style={{ color: 'var(--task-ink-3)' }}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
}

// The ‹ back affordance at the top of a drilled-in axis view.
function BackRow({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="flex items-center gap-1 px-1 pb-2 text-[13px] font-medium"
      style={{ color: 'var(--task-ink-3)' }}
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
      </svg>
      All filters
    </button>
  );
}

// Second level: the axis's options as multi-select TaskOptionRows (tapping
// toggles, the sheet stays open), with optional search and the Select all /
// Clear shortcuts carried over from the old sheet.
function AxisOptionList({ axis, onBack }: { axis: SetAxis; onBack: () => void }) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!axis.searchable || !query) return axis.options;
    const q = query.toLowerCase();
    return axis.options.filter((o) => o.label.toLowerCase().includes(q));
  }, [axis.searchable, axis.options, query]);

  const toggle = (value: string) => {
    const next = new Set(axis.selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    axis.onChange(next);
  };

  return (
    <div className="pb-1">
      <BackRow onBack={onBack} />

      {axis.searchable && (
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          className="mb-2 w-full rounded-lg border bg-transparent px-3 py-2 text-[14px] focus:outline-none"
          style={{
            borderColor: 'var(--task-line)',
            color: 'var(--task-ink-1)',
          }}
        />
      )}

      {(axis.selected.size > 0 || axis.selected.size < axis.options.length) && (
        <div className="flex items-center gap-4 px-1 pb-1.5">
          {axis.selected.size < axis.options.length && (
            <button
              type="button"
              onClick={() => axis.onChange(new Set(axis.options.map((o) => o.value)))}
              className="text-[11px] uppercase tracking-[0.06em] font-medium"
              style={{ color: 'var(--task-ink-3)' }}
            >
              Select all
            </button>
          )}
          {axis.selected.size > 0 && (
            <button
              type="button"
              onClick={() => axis.onChange(new Set())}
              className="text-[11px] uppercase tracking-[0.06em] font-medium"
              style={{ color: 'var(--task-ink-3)' }}
            >
              Clear
            </button>
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="px-2.5 py-3 text-[13px]" style={{ color: 'var(--task-ink-3)' }}>
          No options
        </p>
      ) : (
        filtered.map((opt, idx) => {
          const prevGroup = idx > 0 ? filtered[idx - 1].group : undefined;
          const showGroupHeader = !!opt.group && opt.group !== prevGroup;
          return (
            <React.Fragment key={opt.value}>
              {showGroupHeader && (
                <div
                  className="mt-1.5 border-t px-2.5 pt-3 pb-1 font-mono text-[length:var(--task-fs-label)] uppercase tracking-[0.14em]"
                  style={{ borderColor: 'var(--task-line)', color: 'var(--task-ink-3)' }}
                >
                  {opt.group}
                </div>
              )}
              <TaskOptionRow
                selected={axis.selected.has(opt.value)}
                onSelect={() => toggle(opt.value)}
              >
                <span className="flex w-full items-center justify-between gap-3">
                  <span className="truncate">{opt.label}</span>
                  {opt.count != null && (
                    <span
                      className="shrink-0 text-[12px] tabular-nums"
                      style={{ color: 'var(--task-ink-3)' }}
                    >
                      {opt.count}
                    </span>
                  )}
                </span>
              </TaskOptionRow>
            </React.Fragment>
          );
        })
      )}
    </div>
  );
}

function summarizeSet(selected: Set<string>, options: FilterOption[]): string {
  if (selected.size === 0) return '';
  if (selected.size === 1) {
    const value = Array.from(selected)[0];
    return options.find((o) => o.value === value)?.label || '1 selected';
  }
  return `${selected.size} selected`;
}

function formatRangeSummary(range: DateRange): string {
  if (range.from && range.to) {
    const f = new Date(range.from + 'T00:00:00');
    const t = new Date(range.to + 'T00:00:00');
    const fStr = f.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    const tStr = t.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    return `${fStr} – ${tStr}`;
  }
  if (range.from) {
    const f = new Date(range.from + 'T00:00:00');
    return `from ${f.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })}`;
  }
  if (range.to) {
    const t = new Date(range.to + 'T00:00:00');
    return `until ${t.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })}`;
  }
  return '';
}

// Scheduled-date drill-in: two date fields + clear, in task-panel ink.
function DateRangeFields({
  range,
  onChange,
}: {
  range: DateRange;
  onChange: (next: DateRange) => void;
}) {
  return (
    <div className="flex flex-col gap-2 px-1">
      <label className="flex items-center gap-3">
        <span
          className="w-12 font-mono text-[length:var(--task-fs-label)] uppercase tracking-[0.14em]"
          style={{ color: 'var(--task-ink-3)' }}
        >
          From
        </span>
        <input
          type="date"
          value={range.from || ''}
          onChange={(e) => onChange({ ...range, from: e.target.value || null })}
          className="flex-1 rounded-lg border bg-transparent px-3 py-2 text-[14px] focus:outline-none"
          style={{ borderColor: 'var(--task-line)', color: 'var(--task-ink-1)' }}
        />
      </label>
      <label className="flex items-center gap-3">
        <span
          className="w-12 font-mono text-[length:var(--task-fs-label)] uppercase tracking-[0.14em]"
          style={{ color: 'var(--task-ink-3)' }}
        >
          To
        </span>
        <input
          type="date"
          value={range.to || ''}
          onChange={(e) => onChange({ ...range, to: e.target.value || null })}
          className="flex-1 rounded-lg border bg-transparent px-3 py-2 text-[14px] focus:outline-none"
          style={{ borderColor: 'var(--task-line)', color: 'var(--task-ink-1)' }}
        />
      </label>
      {(range.from || range.to) && (
        <button
          type="button"
          onClick={() => onChange({ from: null, to: null })}
          className="self-start px-0.5 py-1 text-[11px] uppercase tracking-[0.06em] font-medium"
          style={{ color: 'var(--task-ink-3)' }}
        >
          Clear range
        </button>
      )}
    </div>
  );
}

// ============================================================================
// Sort sheet — the standard drawer: sort keys as option rows, then a small
// direction section. Every tap applies and closes, like a badge picker.
// ============================================================================

function SortSheet({
  open,
  onClose,
  sortKey,
  sortDir,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  sortKey: SortKey;
  sortDir: SortDir;
  onChange: (k: SortKey, d: SortDir) => void;
}) {
  const keys = Object.keys(SORT_KEY_LABELS) as SortKey[];
  return (
    <TaskSheet
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title="Sort"
    >
      <div className="pb-1">
        {keys.map((k) => (
          <TaskOptionRow
            key={k}
            selected={k === sortKey}
            onSelect={() => {
              onChange(k, sortDir);
              onClose();
            }}
          >
            {SORT_KEY_LABELS[k]}
          </TaskOptionRow>
        ))}

        <div className="my-1.5 h-px" style={{ background: 'var(--task-line)' }} />
        <div
          className="px-2.5 pt-2 pb-1 font-mono text-[length:var(--task-fs-label)] uppercase tracking-[0.14em]"
          style={{ color: 'var(--task-ink-3)' }}
        >
          Direction
        </div>
        <TaskOptionRow
          selected={sortDir === 'asc'}
          onSelect={() => {
            onChange(sortKey, 'asc');
            onClose();
          }}
        >
          Ascending
        </TaskOptionRow>
        <TaskOptionRow
          selected={sortDir === 'desc'}
          onSelect={() => {
            onChange(sortKey, 'desc');
            onClose();
          }}
        >
          Descending
        </TaskOptionRow>
      </div>
    </TaskSheet>
  );
}
