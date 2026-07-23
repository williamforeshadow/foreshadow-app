'use client';

import * as React from 'react';
import { useMemo, useState } from 'react';
import { AdaptivePicker } from '@/components/tasks/detail/primitives/AdaptivePicker';
import { TaskOptionRow } from '@/components/tasks/detail/primitives/TaskSheet';

// A multi-select filter dropdown that wears the task-detail picker look — the
// same one the assignee field uses (solid surface, checkmark rows; a bottom
// sheet on mobile). Built on AdaptivePicker + TaskOptionRow so it's reusable
// anywhere a set-of-values filter is needed, not tied to the messages page.
//
// Behavior mirrors the older TaskFilterBar MultiSelect it replaces at the
// messages filter: multi-toggle, an optional search box, and a Select all /
// Clear action row. Selection lives in the parent (a Set<string>); this is a
// controlled component.

export interface FilterSelectOption {
  value: string;
  label: string;
}

export function FilterSelect({
  label,
  options,
  selected,
  onChange,
  searchable = false,
  align = 'start',
  block = false,
}: {
  label: string;
  options: FilterSelectOption[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  searchable?: boolean;
  align?: 'start' | 'center' | 'end';
  // `block` renders the trigger as a full-width row (label left, summary +
  // chevron right) instead of an inline pill — for stacked filter panels.
  block?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  // Reset the search each time the picker closes so it reopens clean.
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setQuery('');
  };

  const active = selected.size > 0;
  const summary = active
    ? selected.size === 1
      ? options.find((o) => selected.has(o.value))?.label ?? `${selected.size}`
      : `${selected.size} selected`
    : '';

  const toggle = (value: string) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  };

  const filtered = useMemo(() => {
    if (!searchable || !query.trim()) return options;
    const q = query.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, searchable, query]);

  return (
    <AdaptivePicker
      open={open}
      onOpenChange={handleOpenChange}
      title={label}
      align={align}
      trigger={
        block ? (
          <button
            type="button"
            aria-pressed={active}
            className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors hover:bg-[var(--task-surface-2)]"
            style={{ color: 'var(--task-ink-1)' }}
          >
            <span className="whitespace-nowrap">{label}</span>
            <span className="flex min-w-0 items-center gap-1.5">
              {active && (
                <span
                  className="max-w-[150px] truncate text-[12px] tabular-nums"
                  style={{ color: 'var(--task-accent)' }}
                >
                  {summary}
                </span>
              )}
              <svg className="h-3.5 w-3.5 flex-shrink-0 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </span>
          </button>
        ) : (
          <button
            type="button"
            aria-pressed={active}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors ${
              active
                ? 'border-[var(--accent-3)]/30 bg-[var(--accent-bg-soft)] text-[var(--accent-3)] dark:border-[var(--accent-1)]/30 dark:bg-[var(--accent-bg-soft-dark)] dark:text-[var(--accent-1)]'
                : 'border-[var(--task-line)] bg-transparent text-muted-foreground hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.05]'
            }`}
          >
            <span className="whitespace-nowrap">{label}</span>
            {active && (
              <span className="inline-block max-w-[120px] truncate align-middle text-[10px] tabular-nums opacity-80">
                · {summary}
              </span>
            )}
            <svg className="h-3 w-3 flex-shrink-0 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        )
      }
    >
      {searchable && (
        <div className="px-1 pb-1.5">
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${label.toLowerCase()}…`}
            className="w-full rounded-md border px-2 py-1.5 text-[13px] focus:outline-none"
            style={{
              background: 'var(--task-surface-0)',
              borderColor: 'var(--task-line)',
              color: 'var(--task-ink-1)',
            }}
          />
        </div>
      )}

      {options.length > 0 && (
        <div className="mb-0.5 flex items-center gap-1 px-1">
          {selected.size < options.length && (
            <button
              type="button"
              onClick={() => onChange(new Set(options.map((o) => o.value)))}
              className="flex-1 rounded-md px-2 py-1 text-left font-mono text-[10px] uppercase tracking-[0.12em] hover:bg-[var(--task-surface-2)]"
              style={{ color: 'var(--task-ink-3)' }}
            >
              Select all
            </button>
          )}
          {active && (
            <button
              type="button"
              onClick={() => onChange(new Set())}
              className="flex-1 rounded-md px-2 py-1 text-left font-mono text-[10px] uppercase tracking-[0.12em] hover:bg-[var(--task-surface-2)]"
              style={{ color: 'var(--task-ink-3)' }}
            >
              Clear
            </button>
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="px-2.5 py-3 text-[13px]" style={{ color: 'var(--task-ink-3)' }}>
          No options
        </div>
      ) : (
        filtered.map((o) => (
          <TaskOptionRow key={o.value} selected={selected.has(o.value)} onSelect={() => toggle(o.value)}>
            {o.label}
          </TaskOptionRow>
        ))
      )}
    </AdaptivePicker>
  );
}
