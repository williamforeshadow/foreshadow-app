'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChipScrollLane } from '@/components/ui/chip-scroll-lane';

// Shared filter + sort header used by every task-ledger surface (Property
// Tasks, dashboard Tasks tab, mobile Tasks page).
//
// All state is owned by the parent. This component is a controlled UI that
// emits changes. Multi-select filters are rendered as toggle-button popovers
// that show their current selection summary; sort is a single-select that also
// supports per-key direction toggles; search + new-task are plain buttons.
//
// Each axis (status/assignee/department/bin/origin/priority/property/scheduled
// date range) is optional. A surface can omit an axis by simply not passing
// that pair of props — the corresponding chip won't render. The Property Tasks
// page omits Property (the page is already pre-scoped); the global Tasks tab
// includes it.

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
  /**
   * Optional section heading. When two consecutive options have different
   * `group` values (or one is undefined), the MultiSelect popover renders a
   * small uppercase section header above the second one and a divider line.
   * Use this to break long lists into semantic sections (e.g. "Sub-Bins" vs
   * the unsectioned "Task Bin" / "Not binned" entries at the top).
   *
   * Options are rendered in the order they appear in the `options` array;
   * group together options that share a `group` value.
   */
  group?: string;
}

// Origin filter values. Empty set OR both selected = no filter at the
// consumer's filter layer.
export const ORIGIN_MANUAL = 'manual';
export const ORIGIN_AUTOMATED = 'automated';

export type SortKey =
  | 'scheduled'
  | 'completed'
  | 'created'
  | 'updated'
  | 'priority';
export type SortDir = 'asc' | 'desc';

export interface DateRange {
  from: string | null;
  to: string | null;
}

interface TaskFilterBarProps {
  // Search is optional — surfaces with their own search affordance (e.g. the
  // Timeline's compact expandable search) omit these and no input is rendered.
  search?: string;
  onSearchChange?: (v: string) => void;

  statusOptions: FilterOption[];
  statusSelected: Set<string>;
  onStatusChange: (next: Set<string>) => void;

  assigneeOptions: FilterOption[];
  assigneeSelected: Set<string>;
  onAssigneeChange: (next: Set<string>) => void;

  departmentOptions: FilterOption[];
  departmentSelected: Set<string>;
  onDepartmentChange: (next: Set<string>) => void;

  // Bin selection sentinels (mirrors lib/useTasks.ts):
  //   '__task_bin__' — orphan binned (is_binned=true AND bin_id IS NULL)
  //   '__none__'     — not binned (rendered under the "Other" group header,
  //                    visually separated from the bins themselves)
  // Plus concrete sub-bin UUIDs grouped under "Sub-Bins". There is no
  // "all bins" sentinel — the chip's "Select All" action selects every
  // option (including Not binned, which the user can deselect to
  // restrict to binned tasks only).
  // Optional — when omitted (e.g. on Timeline), the Bin chip isn't rendered.
  binOptions?: FilterOption[];
  binSelected?: Set<string>;
  onBinChange?: (next: Set<string>) => void;

  // Origin: manual / automated. Optional — omit on surfaces where the
  // distinction doesn't matter (e.g. Timeline).
  originOptions?: FilterOption[];
  originSelected?: Set<string>;
  onOriginChange?: (next: Set<string>) => void;

  // Optional — Priority chip. When omitted, the chip isn't rendered.
  priorityOptions?: FilterOption[];
  prioritySelected?: Set<string>;
  onPriorityChange?: (next: Set<string>) => void;

  // Optional — Property chip. When omitted (e.g. on the Property Tasks page,
  // which is already pre-scoped), the chip isn't rendered.
  propertyOptions?: FilterOption[];
  propertySelected?: Set<string>;
  onPropertyChange?: (next: Set<string>) => void;

  // Optional — Scheduled-date range chip. When omitted, the chip isn't
  // rendered. Range is ISO YYYY-MM-DD strings; empty string = no bound.
  scheduledDateRange?: DateRange;
  onScheduledDateRangeChange?: (next: DateRange) => void;

  // Sort is optional — surfaces with an inherent ordering (e.g. the spatial
  // Timeline grid) omit these and the Sort control is not rendered.
  sortKey?: SortKey;
  sortDir?: SortDir;
  onSortChange?: (k: SortKey, d: SortDir) => void;

  onClearAll: () => void;
  anyFilterActive: boolean;

  // Optional. When omitted, no "New task" button is rendered — useful for
  // surfaces that don't support inline creation yet.
  onNewTask?: () => void;

  totalCount: number;
  filteredCount: number;

  // When true, the bar lays out as a SINGLE row (chips + count/clear/new-task)
  // with no internal padding — for surfaces like the Timeline header that want
  // everything on one row alongside other controls. Search is suppressed in
  // this mode (host renders its own compact search).
  inline?: boolean;
}

export function TaskFilterBar(props: TaskFilterBarProps) {
  const inline = !!props.inline;

  const chips = (
    <>
      <MultiSelect
        label="Status"
        options={props.statusOptions}
        selected={props.statusSelected}
        onChange={props.onStatusChange}
      />
      <MultiSelect
        label="Assignee"
        options={props.assigneeOptions}
        selected={props.assigneeSelected}
        onChange={props.onAssigneeChange}
      />
      <MultiSelect
        label="Department"
        options={props.departmentOptions}
        selected={props.departmentSelected}
        onChange={props.onDepartmentChange}
      />
      {props.binOptions && props.binSelected && props.onBinChange && (
        <MultiSelect
          label="Bin"
          options={props.binOptions}
          selected={props.binSelected}
          onChange={props.onBinChange}
        />
      )}
      {props.originOptions && props.originSelected && props.onOriginChange && (
        <MultiSelect
          label="Origin"
          options={props.originOptions}
          selected={props.originSelected}
          onChange={props.onOriginChange}
        />
      )}
      {props.priorityOptions && props.prioritySelected && props.onPriorityChange && (
        <MultiSelect
          label="Priority"
          options={props.priorityOptions}
          selected={props.prioritySelected}
          onChange={props.onPriorityChange}
        />
      )}
      {props.propertyOptions && props.propertySelected && props.onPropertyChange && (
        <MultiSelect
          label="Property"
          options={props.propertyOptions}
          selected={props.propertySelected}
          onChange={props.onPropertyChange}
          searchable
        />
      )}
      {props.scheduledDateRange && props.onScheduledDateRangeChange && (
        <DateRangeChip
          label="Scheduled"
          range={props.scheduledDateRange}
          onChange={props.onScheduledDateRangeChange}
        />
      )}
    </>
  );

  const meta = (
    <div className="ml-auto flex items-center gap-2">
      {props.anyFilterActive && (
        <button
          onClick={props.onClearAll}
          className="text-[11px] font-medium text-neutral-500 dark:text-[#a09e9a] uppercase tracking-[0.04em] px-2 py-1 rounded hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] hover:text-neutral-700 dark:hover:text-[#f0efed] transition-colors"
        >
          Clear
        </button>
      )}
      {props.onNewTask && (
        <button
          onClick={props.onNewTask}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium bg-[var(--accent-3)] text-white hover:bg-[var(--accent-4)] dark:bg-[var(--accent-2)] dark:hover:bg-[var(--accent-1)] dark:text-[#1a1a1a] transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.5}
              d="M12 6v6m0 0v6m0-6h6m-6 0H6"
            />
          </svg>
          New task
        </button>
      )}
    </div>
  );

  if (inline) {
    // Two-track inline layout: a chevron-driven scrollable chip lane that
    // absorbs overflow on narrow viewports / many active filters, then an
    // optional Sort pill (Tasks page uses this), then an anchored meta
    // block (clear + new-task) that stays put.
    return (
      <div className="flex items-center gap-2 flex-nowrap min-w-0 flex-1">
        <ChipScrollLane>{chips}</ChipScrollLane>
        {props.sortKey && props.sortDir && props.onSortChange && (
          <div className="flex-shrink-0">
            <SortSelect
              sortKey={props.sortKey}
              sortDir={props.sortDir}
              onChange={props.onSortChange}
            />
          </div>
        )}
        <div className="flex-shrink-0">{meta}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-8 pt-5 pb-3">
      {/* Row 1: Search + total + clear + new task */}
      <div className="flex items-center gap-3">
        {props.onSearchChange && (
          <div className="relative flex-1 max-w-md">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400 dark:text-[#66645f] pointer-events-none"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              value={props.search ?? ''}
              onChange={(e) => props.onSearchChange!(e.target.value)}
              placeholder="Search tasks by title, property, description..."
              className="w-full pl-9 pr-3 py-2 text-[13px] bg-transparent border border-neutral-200 dark:border-[rgba(255,255,255,0.08)] rounded-md focus:outline-none focus:border-[var(--accent-3)] dark:focus:border-[var(--accent-1)] focus:ring-1 focus:ring-[var(--accent-ring)] dark:focus:ring-[var(--accent-ring-dark)] text-neutral-800 dark:text-[#f0efed] placeholder:text-neutral-400 dark:placeholder:text-[#66645f]"
            />
          </div>
        )}

        {meta}
      </div>

      {/* Row 2: Filter chips + sort */}
      <div className="flex items-center gap-2 flex-wrap">
        {chips}
        {props.sortKey && props.sortDir && props.onSortChange && (
          <div className="ml-auto">
            <SortSelect
              sortKey={props.sortKey}
              sortDir={props.sortDir}
              onChange={props.onSortChange}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ---- MultiSelect popover ---------------------------------------------------

export interface MultiSelectProps {
  label: string;
  options: FilterOption[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  searchable?: boolean;
}

export function MultiSelect({
  label,
  options,
  selected,
  onChange,
  searchable = false,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  // Popover rendered via portal so it escapes the chip-scroll lane's
  // `overflow-x-hidden` clip — without this, the dropdown gets cut off and
  // becomes effectively unusable. Position is computed from the trigger's
  // bounding rect and re-evaluated on scroll / resize.
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });

  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    if (!open) return;
    const updatePos = () => {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // Clamp inside the viewport with an 8px gutter so right-edge chips
      // don't push the popover off-screen.
      const gutter = 8;
      const popWidth = popoverRef.current?.offsetWidth ?? 220;
      const maxLeft = window.innerWidth - popWidth - gutter;
      const left = Math.min(rect.left, Math.max(gutter, maxLeft));
      setPos({ left, top: rect.bottom + 6 });
    };
    updatePos();
    window.addEventListener('resize', updatePos);
    window.addEventListener('scroll', updatePos, true);
    return () => {
      window.removeEventListener('resize', updatePos);
      window.removeEventListener('scroll', updatePos, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const active = selected.size > 0;
  const summary = active
    ? selected.size === 1
      ? options.find((o) => selected.has(o.value))?.label || `${selected.size}`
      : `${selected.size} selected`
    : '';

  const toggle = (value: string) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  };

  const filteredOptions = searchable && query
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  return (
    <div className="relative flex-shrink-0" ref={triggerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium border transition-colors ${
          active
            ? 'bg-[var(--accent-bg-soft)] dark:bg-[var(--accent-bg-soft-dark)] text-[var(--accent-3)] dark:text-[var(--accent-1)] border-[var(--accent-3)]/30 dark:border-[var(--accent-1)]/30'
            : 'bg-transparent text-neutral-600 dark:text-[#a09e9a] border-neutral-200 dark:border-[rgba(255,255,255,0.08)] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] hover:text-neutral-800 dark:hover:text-[#f0efed]'
        }`}
      >
        <span className="whitespace-nowrap">{label}</span>
        {active && (
          <span className="text-[10px] tabular-nums opacity-80 max-w-[120px] truncate inline-block align-middle">· {summary}</span>
        )}
        <svg className="w-3 h-3 opacity-60 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && mounted && createPortal(
        <div
          ref={popoverRef}
          style={{ position: 'fixed', left: pos.left, top: pos.top, zIndex: 9999 }}
          className="min-w-[220px] max-h-[360px] overflow-auto rounded-lg border border-neutral-200 dark:border-[rgba(255,255,255,0.08)] bg-white dark:bg-[#1a1a1a] shadow-lg py-1"
        >
          {searchable && (
            <div className="px-2 pb-1.5 pt-1 sticky top-0 bg-white dark:bg-[#1a1a1a] border-b border-neutral-100 dark:border-[rgba(255,255,255,0.06)]">
              <input
                type="text"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${label.toLowerCase()}...`}
                className="w-full px-2 py-1 text-[12px] bg-transparent border border-neutral-200 dark:border-[rgba(255,255,255,0.08)] rounded-md focus:outline-none focus:border-[var(--accent-3)] dark:focus:border-[var(--accent-1)] text-neutral-800 dark:text-[#f0efed]"
              />
            </div>
          )}
          {filteredOptions.length === 0 ? (
            <div className="px-3 py-2 text-[12px] text-neutral-400 dark:text-[#66645f]">
              No options
            </div>
          ) : (
            <>
              {/* Action row — Select All / Clear. We render the row whenever
                  there's at least one option, so the chip exposes a one-click
                  shortcut to "every option" (the bin chip's user-facing
                  replacement for the old "All bins" sentinel — see
                  TaskFilterBar.binOptions doc) and a one-click clear. The
                  underlying filter logic treats "every option selected" the
                  same as "no selection" (both = no filter), but Select All
                  is still the obvious way to ask for "all of these". */}
              {filteredOptions.length > 0 && (
                <div className="flex items-stretch border-b border-neutral-100 dark:border-[rgba(255,255,255,0.06)]">
                  {selected.size < options.length && (
                    <button
                      onClick={() => onChange(new Set(options.map((o) => o.value)))}
                      className="flex-1 px-3 py-1.5 text-left text-[11px] text-neutral-500 dark:text-[#a09e9a] uppercase tracking-[0.04em] font-medium hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)]"
                    >
                      Select all
                    </button>
                  )}
                  {active && (
                    <button
                      onClick={() => onChange(new Set())}
                      className="flex-1 px-3 py-1.5 text-left text-[11px] text-neutral-500 dark:text-[#a09e9a] uppercase tracking-[0.04em] font-medium hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)]"
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}
              {filteredOptions.map((opt, idx) => {
                const on = selected.has(opt.value);
                // Render a section header (with a thin top divider) whenever
                // this option's `group` differs from the previous option's
                // `group`. The first option in any group gets the header;
                // ungrouped options before the first grouped option are
                // rendered without a header.
                const prevGroup = idx > 0 ? filteredOptions[idx - 1].group : undefined;
                const showGroupHeader = !!opt.group && opt.group !== prevGroup;
                return (
                  <div key={opt.value}>
                    {showGroupHeader && (
                      <div className="px-3 pt-2 pb-1 mt-1 border-t border-neutral-100 dark:border-[rgba(255,255,255,0.06)]">
                        <p className="text-[10px] font-semibold text-neutral-400 dark:text-[#66645f] uppercase tracking-[0.06em]">
                          {opt.group}
                        </p>
                      </div>
                    )}
                    <button
                      onClick={() => toggle(opt.value)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] text-neutral-700 dark:text-[#f0efed]"
                    >
                      <span
                        className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                          on
                            ? 'bg-[var(--accent-3)] dark:bg-[var(--accent-2)] border-[var(--accent-3)] dark:border-[var(--accent-2)]'
                            : 'border-neutral-300 dark:border-[rgba(255,255,255,0.15)]'
                        }`}
                      >
                        {on && (
                          <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </span>
                      <span className="flex-1 truncate">{opt.label}</span>
                      {opt.count != null && (
                        <span className="text-[10px] tabular-nums text-neutral-400 dark:text-[#66645f]">
                          {opt.count}
                        </span>
                      )}
                    </button>
                  </div>
                );
              })}
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

// ---- DateRangeChip --------------------------------------------------------

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

export function DateRangeChip({
  label,
  range,
  onChange,
}: {
  label: string;
  range: DateRange;
  onChange: (next: DateRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });

  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    if (!open) return;
    const updatePos = () => {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const gutter = 8;
      const popWidth = popoverRef.current?.offsetWidth ?? 260;
      const maxLeft = window.innerWidth - popWidth - gutter;
      const left = Math.min(rect.left, Math.max(gutter, maxLeft));
      setPos({ left, top: rect.bottom + 6 });
    };
    updatePos();
    window.addEventListener('resize', updatePos);
    window.addEventListener('scroll', updatePos, true);
    return () => {
      window.removeEventListener('resize', updatePos);
      window.removeEventListener('scroll', updatePos, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const active = !!range.from || !!range.to;
  const summary = formatRangeSummary(range);

  return (
    <div className="relative flex-shrink-0" ref={triggerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium border transition-colors ${
          active
            ? 'bg-[var(--accent-bg-soft)] dark:bg-[var(--accent-bg-soft-dark)] text-[var(--accent-3)] dark:text-[var(--accent-1)] border-[var(--accent-3)]/30 dark:border-[var(--accent-1)]/30'
            : 'bg-transparent text-neutral-600 dark:text-[#a09e9a] border-neutral-200 dark:border-[rgba(255,255,255,0.08)] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] hover:text-neutral-800 dark:hover:text-[#f0efed]'
        }`}
      >
        <span className="whitespace-nowrap">{label}</span>
        {active && (
          <span className="text-[10px] tabular-nums opacity-80 max-w-[120px] truncate inline-block align-middle">· {summary}</span>
        )}
        <svg className="w-3 h-3 opacity-60 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && mounted && createPortal(
        <div
          ref={popoverRef}
          style={{ position: 'fixed', left: pos.left, top: pos.top, zIndex: 9999 }}
          className="min-w-[260px] rounded-lg border border-neutral-200 dark:border-[rgba(255,255,255,0.08)] bg-white dark:bg-[#1a1a1a] shadow-lg p-3 space-y-2"
        >
          <div className="flex items-center gap-2">
            <label className="text-[11px] uppercase tracking-[0.04em] text-neutral-500 dark:text-[#66645f] w-10">
              From
            </label>
            <input
              type="date"
              value={range.from || ''}
              onChange={(e) => onChange({ ...range, from: e.target.value || null })}
              className="flex-1 px-2 py-1 text-[12px] bg-transparent border border-neutral-200 dark:border-[rgba(255,255,255,0.08)] rounded-md focus:outline-none focus:border-[var(--accent-3)] dark:focus:border-[var(--accent-1)] text-neutral-800 dark:text-[#f0efed]"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[11px] uppercase tracking-[0.04em] text-neutral-500 dark:text-[#66645f] w-10">
              To
            </label>
            <input
              type="date"
              value={range.to || ''}
              onChange={(e) => onChange({ ...range, to: e.target.value || null })}
              className="flex-1 px-2 py-1 text-[12px] bg-transparent border border-neutral-200 dark:border-[rgba(255,255,255,0.08)] rounded-md focus:outline-none focus:border-[var(--accent-3)] dark:focus:border-[var(--accent-1)] text-neutral-800 dark:text-[#f0efed]"
            />
          </div>
          {active && (
            <button
              onClick={() => onChange({ from: null, to: null })}
              className="w-full px-2 py-1 text-[11px] uppercase tracking-[0.04em] text-neutral-500 dark:text-[#a09e9a] font-medium rounded hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] hover:text-neutral-700 dark:hover:text-[#f0efed] transition-colors"
            >
              Clear
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

// ---- Sort select ----------------------------------------------------------

export function SortSelect({
  sortKey,
  sortDir,
  onChange,
}: {
  sortKey: SortKey;
  sortDir: SortDir;
  onChange: (k: SortKey, d: SortDir) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const keyLabels: Record<SortKey, string> = {
    scheduled: 'Scheduled date',
    completed: 'Completed date',
    created: 'Created date',
    updated: 'Updated date',
    priority: 'Priority',
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium border bg-transparent text-neutral-600 dark:text-[#a09e9a] border-neutral-200 dark:border-[rgba(255,255,255,0.08)] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] hover:text-neutral-800 dark:hover:text-[#f0efed] transition-colors"
      >
        <span className="text-neutral-400 dark:text-[#66645f]">Sort:</span>
        <span>{keyLabels[sortKey]}</span>
        <span className="text-neutral-400 dark:text-[#66645f]">
          {sortDir === 'asc' ? '↑' : '↓'}
        </span>
        <svg className="w-3 h-3 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 min-w-[220px] rounded-lg border border-neutral-200 dark:border-[rgba(255,255,255,0.08)] bg-white dark:bg-[#1a1a1a] shadow-lg py-1">
          {(Object.keys(keyLabels) as SortKey[]).map((k) => (
            <div key={k} className="flex items-stretch">
              <button
                onClick={() => {
                  onChange(k, sortDir);
                  setOpen(false);
                }}
                className={`flex-1 px-3 py-1.5 text-left text-[12px] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] ${
                  sortKey === k
                    ? 'text-[var(--accent-3)] dark:text-[var(--accent-1)] font-medium'
                    : 'text-neutral-700 dark:text-[#f0efed]'
                }`}
              >
                {keyLabels[k]}
              </button>
              <button
                onClick={() => {
                  onChange(k, sortKey === k && sortDir === 'asc' ? 'desc' : 'asc');
                  setOpen(false);
                }}
                title={
                  sortKey === k
                    ? `Currently ${sortDir === 'asc' ? 'ascending' : 'descending'}`
                    : 'Ascending'
                }
                className="px-2 text-[12px] text-neutral-400 dark:text-[#66645f] hover:text-neutral-700 dark:hover:text-[#f0efed] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)]"
              >
                {sortKey === k ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
