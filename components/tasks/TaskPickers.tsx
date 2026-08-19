'use client';

import React, { useMemo, useState } from 'react';
import type {
  FilterOption,
  SortKey,
  SortDir,
  DateRange,
} from '@/components/tasks/TaskFilterBar';
import { AdaptivePicker } from '@/components/tasks/detail/primitives/AdaptivePicker';
import { TaskOptionRow } from '@/components/tasks/detail/primitives/TaskSheet';

// The standard filter + sort pickers, shared by mobile and desktop. Both are
// built on AdaptivePicker, so the SAME content renders as the TaskSheet
// drawer on mobile and as the anchored task-token popover on desktop —
// literal mirroring, one implementation.
//
//   FilterPicker — two-level drill-in: a root list of axes (label + accent
//     selection summary + chevron), each pushing into its option list of
//     multi-select TaskOptionRows. Axes are optional; wire only what the
//     surface supports (same contract as TaskFilterBar / MobileTaskFilterBar).
//   SortPicker — flat list: sort keys as option rows plus a small Direction
//     section. Every tap applies and closes, like a badge picker.
//
// All selection state lives in the parent (controlled). The trigger is
// supplied by the caller via renderTrigger so each surface keeps its own
// button chrome (funnel icon, sort pill) while the picker itself is shared.

export const SORT_KEY_LABELS: Record<SortKey, string> = {
  scheduled: 'Scheduled date',
  completed: 'Completed date',
  created: 'Created date',
  updated: 'Updated date',
  priority: 'Priority',
};

// ---- Drill-down filter picker ----------------------------------------------
// Generic core: any surface can describe its filter axes and get the standard
// two-level picker. FilterPicker below adapts the task-list prop contract
// onto it; Reservations (turnovers) passes its own axes directly.

export interface FilterAxisSpec {
  id: string;
  label: string;
  options: FilterOption[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  searchable?: boolean;
  /** Axis whose two values are complementary (e.g. Origin manual/automated):
   *  both selected == "no filter", so the summary and active count only
   *  register when exactly one is chosen. */
  exclusivePair?: boolean;
}

type AxisView = 'root' | 'dateRange' | (string & {});

export interface FilterPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Renders the trigger button; receives the live active-filter count so the
   *  caller can badge it. */
  renderTrigger: (activeCount: number) => React.ReactElement;
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

/** A from/to date-range axis (its own drill-in view with two date fields). */
export interface RangeAxisSpec {
  id: string;
  label: string;
  range: DateRange;
  onChange: (next: DateRange) => void;
}

export interface DrillDownFilterPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  renderTrigger: (activeCount: number) => React.ReactElement;
  onClearAll: () => void;
  axes: FilterAxisSpec[];
  /** Multiple named range axes (e.g. Messages' Check-in + Check-out). */
  dateRanges?: RangeAxisSpec[];
  // Single-range sugar, used by the task-list adapter.
  dateRange?: DateRange;
  onDateRangeChange?: (next: DateRange) => void;
  dateRangeLabel?: string;
}

export function DrillDownFilterPicker({
  open,
  onOpenChange,
  renderTrigger,
  onClearAll,
  axes,
  dateRanges,
  dateRange,
  onDateRangeChange,
  dateRangeLabel = 'Scheduled date',
}: DrillDownFilterPickerProps) {
  const [view, setView] = useState<AxisView>('root');

  // Reset to the root list whenever the picker closes, so reopening never
  // lands mid-drill-in.
  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
    if (!next) setView('root');
  };

  // Named range axes; the single dateRange props fold in as one more entry.
  const ranges: RangeAxisSpec[] = [
    ...(dateRanges ?? []),
    ...(dateRange && onDateRangeChange
      ? [{ id: '__dateRange__', label: dateRangeLabel, range: dateRange, onChange: onDateRangeChange }]
      : []),
  ];

  const activeCount =
    axes.reduce(
      (n, a) => n + (a.exclusivePair ? (a.selected.size === 1 ? 1 : 0) : a.selected.size),
      0
    ) + ranges.filter((r) => r.range.from || r.range.to).length;

  const activeAxis = view !== 'root' ? axes.find((a) => a.id === view) : undefined;
  const activeRange = view !== 'root' ? ranges.find((r) => `range:${r.id}` === view) : undefined;

  const title =
    view === 'root'
      ? activeCount > 0
        ? `Filters · ${activeCount}`
        : 'Filters'
      : activeRange?.label ?? activeAxis?.label ?? 'Filters';

  const axisSummary = (axis: FilterAxisSpec): string => {
    if (axis.exclusivePair) {
      return axis.selected.size === 1
        ? axis.options.find((o) => axis.selected.has(o.value))?.label || ''
        : '';
    }
    return summarizeSet(axis.selected, axis.options);
  };

  return (
    <AdaptivePicker
      open={open}
      onOpenChange={handleOpenChange}
      title={title}
      // Drilled-in views draw their own header (back row + label) so the
      // chrome title only shows on the root list.
      titleHidden={view !== 'root'}
      trigger={renderTrigger(activeCount)}
      contentClassName="w-80"
      scrollAreaClassName="max-h-[min(65vh,480px)]"
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
          {ranges.map((r) => (
            <AxisRow
              key={r.id}
              label={r.label}
              summary={formatRangeSummary(r.range)}
              onOpen={() => setView(`range:${r.id}`)}
            />
          ))}
          {activeCount > 0 && (
            <>
              <div className="my-1.5 h-px" style={{ background: 'var(--task-line)' }} />
              <button
                type="button"
                onClick={onClearAll}
                className="flex w-full items-center rounded-lg px-2.5 text-left transition-colors min-h-[50px] active:bg-[var(--task-surface-2)] hover:bg-[var(--task-surface-2)]"
              >
                <span className="text-[15px]" style={{ color: 'var(--task-ink-3)' }}>
                  Clear all filters
                </span>
              </button>
            </>
          )}
        </div>
      ) : activeRange ? (
        <div className="pb-1">
          <div className="flex items-center justify-between gap-3 pb-3.5">
            <BackRow onBack={() => setView('root')} />
            {(activeRange.range.from || activeRange.range.to) && (
              <button
                type="button"
                onClick={() => activeRange.onChange({ from: null, to: null })}
                className="text-[11px] uppercase tracking-[0.06em] font-medium"
                style={{ color: 'var(--task-ink-3)' }}
              >
                Clear
              </button>
            )}
          </div>
          <AxisLabel>{activeRange.label}</AxisLabel>
          <DateRangeFields range={activeRange.range} onChange={activeRange.onChange} />
        </div>
      ) : activeAxis ? (
        <AxisOptionList key={activeAxis.id} axis={activeAxis} onBack={() => setView('root')} />
      ) : null}
    </AdaptivePicker>
  );
}

// ---- FilterPicker (task-list axis adapter) ---------------------------------

export function FilterPicker(props: FilterPickerProps) {
  const axes: FilterAxisSpec[] = useMemo(() => {
    const out: FilterAxisSpec[] = [];
    if (props.statusOptions && props.statusSelected && props.onStatusChange)
      out.push({ id: 'status', label: 'Status', options: props.statusOptions, selected: props.statusSelected, onChange: props.onStatusChange });
    if (props.assigneeOptions && props.assigneeSelected && props.onAssigneeChange)
      out.push({ id: 'assignee', label: 'Assignee', options: props.assigneeOptions, selected: props.assigneeSelected, onChange: props.onAssigneeChange, searchable: true });
    if (props.departmentOptions && props.departmentSelected && props.onDepartmentChange)
      out.push({ id: 'department', label: 'Department', options: props.departmentOptions, selected: props.departmentSelected, onChange: props.onDepartmentChange });
    if (props.binOptions && props.binSelected && props.onBinChange)
      out.push({ id: 'bin', label: 'Bin', options: props.binOptions, selected: props.binSelected, onChange: props.onBinChange });
    if (props.originOptions && props.originSelected && props.onOriginChange)
      out.push({ id: 'origin', label: 'Origin', options: props.originOptions, selected: props.originSelected, onChange: props.onOriginChange, exclusivePair: true });
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

  return (
    <DrillDownFilterPicker
      open={props.open}
      onOpenChange={props.onOpenChange}
      renderTrigger={props.renderTrigger}
      onClearAll={props.onClearAll}
      axes={axes}
      dateRange={props.scheduledDateRange}
      onDateRangeChange={props.onScheduledDateRangeChange}
    />
  );
}

// A root-level row: axis label, current selection summary in accent, chevron.
// Sized and surfaced identically to TaskOptionRow so both levels read as the
// same picker.
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
      className="flex items-center gap-1 px-1 text-[13px] font-medium"
      style={{ color: 'var(--task-ink-3)' }}
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
      </svg>
      All filters
    </button>
  );
}

// The field label inside a drilled-in view — styled exactly like the picker
// chrome's title, but rendered below the back row per the drill-in order:
// back row (with actions top-right) → label → search → options.
function AxisLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="px-1 pb-2 font-mono text-[length:var(--task-fs-label)] uppercase tracking-[0.14em]"
      style={{ color: 'var(--task-ink-3)' }}
    >
      {children}
    </div>
  );
}

// Second level: the axis's options as multi-select TaskOptionRows (tapping
// toggles, the picker stays open), with optional search and the Select all /
// Clear shortcuts.
function AxisOptionList({ axis, onBack }: { axis: FilterAxisSpec; onBack: () => void }) {
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
      {/* Header row: back on the left, Select all / Clear top-right. */}
      <div className="flex items-center justify-between gap-3 pb-3.5">
        <BackRow onBack={onBack} />
        <div className="flex items-center gap-4">
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
      </div>

      <AxisLabel>{axis.label}</AxisLabel>

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
    const fStr = f.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const tStr = t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${fStr} – ${tStr}`;
  }
  if (range.from) {
    const f = new Date(range.from + 'T00:00:00');
    return `from ${f.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  }
  if (range.to) {
    const t = new Date(range.to + 'T00:00:00');
    return `until ${t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
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
    </div>
  );
}

// ---- SortPicker ------------------------------------------------------------

export function SortPicker({
  open,
  onOpenChange,
  trigger,
  sortKey,
  sortDir,
  onChange,
  align = 'end',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: React.ReactElement;
  sortKey: SortKey;
  sortDir: SortDir;
  onChange: (k: SortKey, d: SortDir) => void;
  align?: 'start' | 'center' | 'end';
}) {
  const keys = Object.keys(SORT_KEY_LABELS) as SortKey[];
  const close = () => onOpenChange(false);
  return (
    <AdaptivePicker
      open={open}
      onOpenChange={onOpenChange}
      title="Sort"
      trigger={trigger}
      align={align}
    >
      <div className="pb-1">
        {keys.map((k) => (
          <TaskOptionRow
            key={k}
            selected={k === sortKey}
            onSelect={() => {
              onChange(k, sortDir);
              close();
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
            close();
          }}
        >
          Ascending
        </TaskOptionRow>
        <TaskOptionRow
          selected={sortDir === 'desc'}
          onSelect={() => {
            onChange(sortKey, 'desc');
            close();
          }}
        >
          Descending
        </TaskOptionRow>
      </div>
    </AdaptivePicker>
  );
}
