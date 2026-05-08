'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  FilterOption,
  SortKey,
  SortDir,
  DateRange,
} from '@/components/tasks/TaskFilterBar';

// Mobile-native filter/sort UX for the global Tasks ledger.
//
// Why this exists separately from the shared (desktop) `TaskFilterBar`:
//   - The desktop bar lays out 8+ filter chips + sort + search in a row,
//     which doesn't fit on a phone. Forcing it inside `overflow-x-auto`
//     produces a long horizontal scroll AND clips the chip popovers.
//   - This component collapses everything into a single compact row
//     (search + Filter button + Sort button + New task) and exposes the
//     full-fidelity filter UI inside a portalled bottom sheet, so the
//     sheet is never clipped by parent scroll containers and always
//     stacks above the task list.
//
// All state stays owned by the parent (same controlled-component pattern
// as `TaskFilterBar`). The data shapes are 1:1 with `useTasks` outputs.

interface Props {
  search: string;
  onSearchChange: (v: string) => void;

  statusOptions: FilterOption[];
  statusSelected: Set<string>;
  onStatusChange: (next: Set<string>) => void;

  assigneeOptions: FilterOption[];
  assigneeSelected: Set<string>;
  onAssigneeChange: (next: Set<string>) => void;

  departmentOptions: FilterOption[];
  departmentSelected: Set<string>;
  onDepartmentChange: (next: Set<string>) => void;

  binOptions: FilterOption[];
  binSelected: Set<string>;
  onBinChange: (next: Set<string>) => void;

  originOptions: FilterOption[];
  originSelected: Set<string>;
  onOriginChange: (next: Set<string>) => void;

  priorityOptions?: FilterOption[];
  prioritySelected?: Set<string>;
  onPriorityChange?: (next: Set<string>) => void;

  propertyOptions?: FilterOption[];
  propertySelected?: Set<string>;
  onPropertyChange?: (next: Set<string>) => void;

  scheduledDateRange?: DateRange;
  onScheduledDateRangeChange?: (next: DateRange) => void;

  sortKey: SortKey;
  sortDir: SortDir;
  onSortChange: (k: SortKey, d: SortDir) => void;

  onClearAll: () => void;
  anyFilterActive: boolean;

  onNewTask?: () => void;

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

  // Active-filter chip count for the "Filter" button badge. Origin counts
  // only when exactly one of (manual / automated) is selected — both
  // selected is functionally "no filter" at the consumer's filter layer.
  const activeCount = useMemo(() => {
    let n = 0;
    n += props.statusSelected.size;
    n += props.assigneeSelected.size;
    n += props.departmentSelected.size;
    n += props.binSelected.size;
    if (props.originSelected.size === 1) n += 1;
    if (props.prioritySelected) n += props.prioritySelected.size;
    if (props.propertySelected) n += props.propertySelected.size;
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

  return (
    <div className="flex flex-col gap-2 px-4 pt-2 pb-3">
      {/* Row 1: search */}
      <div className="relative">
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
          value={props.search}
          onChange={(e) => props.onSearchChange(e.target.value)}
          placeholder="Search tasks..."
          className="w-full pl-9 pr-3 py-2 text-[14px] bg-transparent border border-neutral-200 dark:border-[rgba(255,255,255,0.08)] rounded-md focus:outline-none focus:border-[var(--accent-3)] dark:focus:border-[var(--accent-1)] focus:ring-1 focus:ring-[var(--accent-ring)] dark:focus:ring-[var(--accent-ring-dark)] text-neutral-800 dark:text-[#f0efed] placeholder:text-neutral-400 dark:placeholder:text-[#66645f]"
        />
      </div>

      {/* Row 2: Filter, Sort, count, new task */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setFilterOpen(true)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors ${
            activeCount > 0
              ? 'bg-[var(--accent-bg-soft)] dark:bg-[var(--accent-bg-soft-dark)] text-[var(--accent-3)] dark:text-[var(--accent-1)] border-[var(--accent-3)]/30 dark:border-[var(--accent-1)]/30'
              : 'bg-transparent text-neutral-600 dark:text-[#a09e9a] border-neutral-200 dark:border-[rgba(255,255,255,0.08)]'
          }`}
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
              d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L15 12.414V19a1 1 0 01-.553.894l-4 2A1 1 0 019 21v-8.586L3.293 6.707A1 1 0 013 6V4z"
            />
          </svg>
          <span>Filter</span>
          {activeCount > 0 && (
            <span className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-[var(--accent-3)] dark:bg-[var(--accent-2)] text-white dark:text-[#1a1a1a] text-[10px] font-semibold tabular-nums px-1">
              {activeCount}
            </span>
          )}
        </button>

        <button
          onClick={() => setSortOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium border bg-transparent text-neutral-600 dark:text-[#a09e9a] border-neutral-200 dark:border-[rgba(255,255,255,0.08)]"
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
          <span>{SORT_KEY_LABELS[props.sortKey]}</span>
          <span className="text-neutral-400 dark:text-[#66645f]">
            {props.sortDir === 'asc' ? '↑' : '↓'}
          </span>
        </button>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] text-neutral-500 dark:text-[#66645f] tabular-nums">
            {props.anyFilterActive
              ? `${props.filteredCount}/${props.totalCount}`
              : `${props.totalCount}`}
          </span>
          {props.onNewTask && (
            <button
              onClick={props.onNewTask}
              className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-[var(--accent-3)] text-white hover:bg-[var(--accent-4)] dark:bg-[var(--accent-2)] dark:hover:bg-[var(--accent-1)] dark:text-[#1a1a1a] transition-colors"
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
      </div>

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

      <SortSheet
        open={sortOpen}
        onClose={() => setSortOpen(false)}
        sortKey={props.sortKey}
        sortDir={props.sortDir}
        onChange={props.onSortChange}
      />
    </div>
  );
}

// ============================================================================
// Bottom sheet primitive
// ============================================================================

function BottomSheet({
  open,
  onClose,
  title,
  headerRight,
  children,
  fullHeight = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
  fullHeight?: boolean;
}) {
  // SSR-safe portal target.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Lock body scroll while open so the sheet captures all gestures.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[80]">
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
      />
      {/* Sheet */}
      <div
        className={`absolute left-0 right-0 bottom-0 bg-white dark:bg-background rounded-t-2xl border-t border-neutral-200 dark:border-[rgba(255,255,255,0.08)] shadow-[0_-8px_32px_rgba(0,0,0,0.18)] flex flex-col`}
        style={{ maxHeight: '88dvh', height: fullHeight ? '88dvh' : 'auto' }}
      >
        {/* Grabber */}
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 rounded-full bg-neutral-300 dark:bg-[rgba(255,255,255,0.15)]" />
        </div>
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-1 pb-3 border-b border-neutral-200 dark:border-[rgba(255,255,255,0.06)]">
          <h2 className="text-[15px] font-semibold text-neutral-900 dark:text-[#f0efed]">
            {title}
          </h2>
          <div className="flex items-center gap-2">
            {headerRight}
            <button
              onClick={onClose}
              className="w-8 h-8 inline-flex items-center justify-center rounded-full text-neutral-500 dark:text-[#a09e9a] hover:bg-[rgba(30,25,20,0.05)] dark:hover:bg-[rgba(255,255,255,0.05)]"
              aria-label="Close"
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
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
        {/* Body */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ============================================================================
// Filter sheet
// ============================================================================

interface FilterSheetProps {
  open: boolean;
  onClose: () => void;
  activeCount: number;
  onClearAll: () => void;

  statusOptions: FilterOption[];
  statusSelected: Set<string>;
  onStatusChange: (next: Set<string>) => void;

  assigneeOptions: FilterOption[];
  assigneeSelected: Set<string>;
  onAssigneeChange: (next: Set<string>) => void;

  departmentOptions: FilterOption[];
  departmentSelected: Set<string>;
  onDepartmentChange: (next: Set<string>) => void;

  binOptions: FilterOption[];
  binSelected: Set<string>;
  onBinChange: (next: Set<string>) => void;

  originOptions: FilterOption[];
  originSelected: Set<string>;
  onOriginChange: (next: Set<string>) => void;

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
  return (
    <BottomSheet
      open={props.open}
      onClose={props.onClose}
      title={
        props.activeCount > 0
          ? `Filters · ${props.activeCount}`
          : 'Filters'
      }
      headerRight={
        props.activeCount > 0 ? (
          <button
            onClick={props.onClearAll}
            className="text-[12px] font-medium text-[var(--accent-3)] dark:text-[var(--accent-1)] uppercase tracking-[0.04em] px-2 py-1"
          >
            Clear all
          </button>
        ) : undefined
      }
      fullHeight
    >
      <div className="divide-y divide-neutral-200 dark:divide-[rgba(255,255,255,0.06)]">
        <AccordionSection
          label="Status"
          summary={summarizeSet(props.statusSelected, props.statusOptions)}
        >
          <CheckboxList
            options={props.statusOptions}
            selected={props.statusSelected}
            onChange={props.onStatusChange}
          />
        </AccordionSection>

        <AccordionSection
          label="Assignee"
          summary={summarizeSet(props.assigneeSelected, props.assigneeOptions)}
        >
          <CheckboxList
            options={props.assigneeOptions}
            selected={props.assigneeSelected}
            onChange={props.onAssigneeChange}
            searchable
          />
        </AccordionSection>

        <AccordionSection
          label="Department"
          summary={summarizeSet(
            props.departmentSelected,
            props.departmentOptions
          )}
        >
          <CheckboxList
            options={props.departmentOptions}
            selected={props.departmentSelected}
            onChange={props.onDepartmentChange}
          />
        </AccordionSection>

        <AccordionSection
          label="Bin"
          summary={summarizeSet(props.binSelected, props.binOptions)}
        >
          <CheckboxList
            options={props.binOptions}
            selected={props.binSelected}
            onChange={props.onBinChange}
          />
        </AccordionSection>

        <AccordionSection
          label="Origin"
          summary={
            props.originSelected.size === 1
              ? props.originOptions.find((o) =>
                  props.originSelected.has(o.value)
                )?.label || ''
              : ''
          }
        >
          <CheckboxList
            options={props.originOptions}
            selected={props.originSelected}
            onChange={props.onOriginChange}
          />
        </AccordionSection>

        {props.priorityOptions && props.prioritySelected && props.onPriorityChange && (
          <AccordionSection
            label="Priority"
            summary={summarizeSet(props.prioritySelected, props.priorityOptions)}
          >
            <CheckboxList
              options={props.priorityOptions}
              selected={props.prioritySelected}
              onChange={props.onPriorityChange}
            />
          </AccordionSection>
        )}

        {props.propertyOptions && props.propertySelected && props.onPropertyChange && (
          <AccordionSection
            label="Property"
            summary={summarizeSet(props.propertySelected, props.propertyOptions)}
          >
            <CheckboxList
              options={props.propertyOptions}
              selected={props.propertySelected}
              onChange={props.onPropertyChange}
              searchable
            />
          </AccordionSection>
        )}

        {props.scheduledDateRange && props.onScheduledDateRangeChange && (
          <AccordionSection
            label="Scheduled date"
            summary={formatRangeSummary(props.scheduledDateRange)}
          >
            <DateRangePicker
              range={props.scheduledDateRange}
              onChange={props.onScheduledDateRangeChange}
            />
          </AccordionSection>
        )}
      </div>

      <div className="px-4 py-3">
        <button
          onClick={props.onClose}
          className="w-full px-4 py-2.5 rounded-md bg-[var(--accent-3)] text-white hover:bg-[var(--accent-4)] dark:bg-[var(--accent-2)] dark:hover:bg-[var(--accent-1)] dark:text-[#1a1a1a] text-[13px] font-medium transition-colors"
        >
          Done
        </button>
      </div>
    </BottomSheet>
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

// ============================================================================
// Accordion section
// ============================================================================

function AccordionSection({
  label,
  summary,
  defaultOpen = false,
  children,
}: {
  label: string;
  summary?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const active = !!summary;

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3.5 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[14px] font-medium text-neutral-800 dark:text-[#f0efed]">
            {label}
          </span>
          {active && (
            <span className="text-[11px] tabular-nums text-[var(--accent-3)] dark:text-[var(--accent-1)] font-medium truncate max-w-[180px]">
              · {summary}
            </span>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-neutral-400 dark:text-[#66645f] transition-transform shrink-0 ${
            open ? 'rotate-180' : ''
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

// ============================================================================
// Checkbox list (with optional search)
// ============================================================================

function CheckboxList({
  options,
  selected,
  onChange,
  searchable = false,
}: {
  options: FilterOption[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  searchable?: boolean;
}) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!searchable || !query) return options;
    const q = query.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [searchable, query, options]);

  const toggle = (value: string) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-1">
      {searchable && (
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search..."
          className="w-full px-3 py-2 mb-1 text-[13px] bg-transparent border border-neutral-200 dark:border-[rgba(255,255,255,0.08)] rounded-md focus:outline-none focus:border-[var(--accent-3)] dark:focus:border-[var(--accent-1)] text-neutral-800 dark:text-[#f0efed] placeholder:text-neutral-400 dark:placeholder:text-[#66645f]"
        />
      )}
      {/* Action row — Select All / Clear. Same shortcut as desktop: gives
          the chip a one-click "every option" action (e.g. for the bin chip
          this replaces the old "All bins" sentinel) and a one-click clear.
          "All selected" and "none selected" are functionally the same in
          our match logic, but Select All is the obvious gesture for "all". */}
      {(options.length > 0 && (selected.size > 0 || selected.size < options.length)) && (
        <div className="flex items-center gap-3 mb-1">
          {selected.size < options.length && (
            <button
              onClick={() => onChange(new Set(options.map((o) => o.value)))}
              className="text-[11px] uppercase tracking-[0.04em] font-medium text-neutral-500 dark:text-[#a09e9a]"
            >
              Select all
            </button>
          )}
          {selected.size > 0 && (
            <button
              onClick={() => onChange(new Set())}
              className="text-[11px] uppercase tracking-[0.04em] font-medium text-neutral-500 dark:text-[#a09e9a]"
            >
              Clear
            </button>
          )}
        </div>
      )}
      <div className="max-h-[40vh] overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="text-[12px] text-neutral-400 dark:text-[#66645f] py-2">
            No options
          </p>
        ) : (
          filtered.map((opt, idx) => {
            const on = selected.has(opt.value);
            // Mirror the desktop MultiSelect: insert a thin section header
            // whenever this option's `group` differs from the previous option's
            // (e.g. "SUB-BINS" header above the sub-bin entries in the bin
            // filter, with the unsectioned entries staying ungrouped at top).
            const prevGroup = idx > 0 ? filtered[idx - 1].group : undefined;
            const showGroupHeader = !!opt.group && opt.group !== prevGroup;
            return (
              <div key={opt.value}>
                {showGroupHeader && (
                  <div className="px-1 pt-3 pb-1 mt-1 border-t border-neutral-100 dark:border-[rgba(255,255,255,0.06)]">
                    <p className="text-[10px] font-semibold text-neutral-400 dark:text-[#66645f] uppercase tracking-[0.06em]">
                      {opt.group}
                    </p>
                  </div>
                )}
                <button
                  onClick={() => toggle(opt.value)}
                  className="w-full flex items-center gap-3 px-1 py-2.5 text-left text-[13px] text-neutral-700 dark:text-[#f0efed] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] rounded-md"
                >
                  <span
                    className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                      on
                        ? 'bg-[var(--accent-3)] dark:bg-[var(--accent-2)] border-[var(--accent-3)] dark:border-[var(--accent-2)]'
                        : 'border-neutral-300 dark:border-[rgba(255,255,255,0.15)]'
                    }`}
                  >
                    {on && (
                      <svg
                        className="w-3 h-3 text-white dark:text-[#1a1a1a]"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={3}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    )}
                  </span>
                  <span className="flex-1 truncate">{opt.label}</span>
                  {opt.count != null && (
                    <span className="text-[11px] tabular-nums text-neutral-400 dark:text-[#66645f]">
                      {opt.count}
                    </span>
                  )}
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Date range picker
// ============================================================================

function DateRangePicker({
  range,
  onChange,
}: {
  range: DateRange;
  onChange: (next: DateRange) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-3">
        <span className="text-[12px] uppercase tracking-[0.04em] text-neutral-500 dark:text-[#66645f] w-12">
          From
        </span>
        <input
          type="date"
          value={range.from || ''}
          onChange={(e) => onChange({ ...range, from: e.target.value || null })}
          className="flex-1 px-3 py-2 text-[13px] bg-transparent border border-neutral-200 dark:border-[rgba(255,255,255,0.08)] rounded-md focus:outline-none focus:border-[var(--accent-3)] dark:focus:border-[var(--accent-1)] text-neutral-800 dark:text-[#f0efed]"
        />
      </label>
      <label className="flex items-center gap-3">
        <span className="text-[12px] uppercase tracking-[0.04em] text-neutral-500 dark:text-[#66645f] w-12">
          To
        </span>
        <input
          type="date"
          value={range.to || ''}
          onChange={(e) => onChange({ ...range, to: e.target.value || null })}
          className="flex-1 px-3 py-2 text-[13px] bg-transparent border border-neutral-200 dark:border-[rgba(255,255,255,0.08)] rounded-md focus:outline-none focus:border-[var(--accent-3)] dark:focus:border-[var(--accent-1)] text-neutral-800 dark:text-[#f0efed]"
        />
      </label>
      {(range.from || range.to) && (
        <button
          onClick={() => onChange({ from: null, to: null })}
          className="self-start text-[11px] uppercase tracking-[0.04em] font-medium text-neutral-500 dark:text-[#a09e9a]"
        >
          Clear range
        </button>
      )}
    </div>
  );
}

// ============================================================================
// Sort sheet
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
    <BottomSheet open={open} onClose={onClose} title="Sort">
      <div className="px-2 py-2">
        {keys.map((k) => {
          const isActive = sortKey === k;
          return (
            <div key={k} className="flex items-stretch gap-1">
              <button
                onClick={() => {
                  onChange(k, sortDir);
                  onClose();
                }}
                className={`flex-1 flex items-center gap-3 px-3 py-3 text-left text-[14px] rounded-md ${
                  isActive
                    ? 'text-[var(--accent-3)] dark:text-[var(--accent-1)] font-medium bg-[var(--accent-bg-soft)] dark:bg-[var(--accent-bg-soft-dark)]'
                    : 'text-neutral-700 dark:text-[#f0efed]'
                }`}
              >
                <span
                  className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                    isActive
                      ? 'border-[var(--accent-3)] dark:border-[var(--accent-1)]'
                      : 'border-neutral-300 dark:border-[rgba(255,255,255,0.15)]'
                  }`}
                >
                  {isActive && (
                    <span className="w-2 h-2 rounded-full bg-[var(--accent-3)] dark:bg-[var(--accent-1)]" />
                  )}
                </span>
                <span>{SORT_KEY_LABELS[k]}</span>
              </button>
              <button
                onClick={() => {
                  onChange(
                    k,
                    isActive && sortDir === 'asc' ? 'desc' : 'asc'
                  );
                  onClose();
                }}
                className={`px-3 text-[14px] rounded-md ${
                  isActive
                    ? 'text-[var(--accent-3)] dark:text-[var(--accent-1)]'
                    : 'text-neutral-400 dark:text-[#66645f]'
                }`}
                aria-label="Toggle direction"
                title={
                  isActive
                    ? `Currently ${sortDir === 'asc' ? 'ascending' : 'descending'}`
                    : 'Set ascending'
                }
              >
                {isActive ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
              </button>
            </div>
          );
        })}
      </div>
    </BottomSheet>
  );
}
