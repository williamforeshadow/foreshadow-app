'use client';

import { useState } from 'react';
import { AdaptivePicker } from '@/components/tasks/detail/primitives/AdaptivePicker';

// A from/to date-range filter dropdown wearing the same task-detail picker look
// as FilterSelect, so a filter panel that mixes value-lists and date-ranges
// stays visually consistent. A date range isn't a list of options, so it can't
// use TaskOptionRow — it puts two native date inputs (and a Clear) inside the
// shared AdaptivePicker surface instead. Controlled; reusable.

export interface FilterDateRangeValue {
  from: string | null;
  to: string | null;
}

function formatSummary(range: FilterDateRangeValue): string {
  const fmt = (d: string) =>
    new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (range.from && range.to) return `${fmt(range.from)} – ${fmt(range.to)}`;
  if (range.from) return `from ${fmt(range.from)}`;
  if (range.to) return `until ${fmt(range.to)}`;
  return '';
}

export function FilterDateRange({
  label,
  range,
  onChange,
  align = 'start',
  block = false,
}: {
  label: string;
  range: FilterDateRangeValue;
  onChange: (next: FilterDateRangeValue) => void;
  align?: 'start' | 'center' | 'end';
  // Full-width row trigger (vs inline pill) — matches FilterSelect's `block`.
  block?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const active = !!range.from || !!range.to;
  const summary = formatSummary(range);

  const inputStyle = {
    background: 'var(--task-surface-0)',
    borderColor: 'var(--task-line)',
    color: 'var(--task-ink-1)',
  } as const;

  return (
    <AdaptivePicker
      open={open}
      onOpenChange={setOpen}
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
      <div className="flex flex-col gap-2 px-1 py-0.5">
        <label className="flex items-center gap-2">
          <span className="w-9 font-mono text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--task-ink-3)' }}>
            From
          </span>
          <input
            type="date"
            value={range.from || ''}
            onChange={(e) => onChange({ ...range, from: e.target.value || null })}
            className="flex-1 rounded-md border px-2 py-1.5 text-[13px] focus:outline-none"
            style={inputStyle}
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="w-9 font-mono text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--task-ink-3)' }}>
            To
          </span>
          <input
            type="date"
            value={range.to || ''}
            onChange={(e) => onChange({ ...range, to: e.target.value || null })}
            className="flex-1 rounded-md border px-2 py-1.5 text-[13px] focus:outline-none"
            style={inputStyle}
          />
        </label>
        {active && (
          <button
            type="button"
            onClick={() => onChange({ from: null, to: null })}
            className="rounded-md px-2 py-1 text-left font-mono text-[10px] uppercase tracking-[0.12em] hover:bg-[var(--task-surface-2)]"
            style={{ color: 'var(--task-ink-3)' }}
          >
            Clear
          </button>
        )}
      </div>
    </AdaptivePicker>
  );
}
