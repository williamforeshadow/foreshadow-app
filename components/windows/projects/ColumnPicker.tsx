'use client';

import { useState, useMemo } from 'react';
import { AdaptivePicker } from '@/components/tasks/detail/primitives/AdaptivePicker';
import { TaskOptionRow } from '@/components/tasks/detail/primitives/TaskSheet';

// Kanban column visibility picker — the standard picker (anchored popover on
// desktop, bottom drawer on mobile) behind the "Columns" pill. Multi-select:
// toggling a column keeps the picker open.

interface ColumnOption {
  id: string;
  name: string;
}

interface ColumnPickerProps {
  columns: ColumnOption[];
  visibleColumnIds: Set<string>;
  onToggle: (columnId: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  // When false, the `· N/M` count tail is hidden (mobile keeps the pill
  // clean). Defaults to true so desktop is unchanged.
  showCount?: boolean;
}

export function ColumnPicker({
  columns,
  visibleColumnIds,
  onToggle,
  onSelectAll,
  onClearAll,
  showCount = true,
}: ColumnPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setSearch('');
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return columns;
    const lower = search.toLowerCase();
    return columns.filter((c) => c.name.toLowerCase().includes(lower));
  }, [columns, search]);

  const selectedCount = visibleColumnIds.size;
  const totalCount = columns.length;

  // Pill aesthetic matches the Boards pill + the filter chips: soft purple
  // highlight when any column is filtered out, neutral otherwise.
  const restricted = selectedCount > 0 && selectedCount < totalCount;

  return (
    <AdaptivePicker
      open={open}
      onOpenChange={handleOpenChange}
      title="Columns"
      align="end"
      trigger={
        <button
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium border transition-colors ${
            restricted
              ? 'bg-[var(--accent-bg-soft)] dark:bg-[var(--accent-bg-soft-dark)] text-[var(--accent-3)] dark:text-[var(--accent-1)] border-[var(--accent-3)]/30 dark:border-[var(--accent-1)]/30'
              : 'bg-transparent text-neutral-600 dark:text-[#a09e9a] border-neutral-200 dark:border-[rgba(255,255,255,0.08)] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] hover:text-neutral-800 dark:hover:text-[#f0efed]'
          }`}
        >
          <span>Columns</span>
          {showCount && (
            <span className="text-[10px] tabular-nums opacity-80">
              · {selectedCount}/{totalCount}
            </span>
          )}
          <svg className={`w-3 h-3 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      }
    >
      <div className="pb-1">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search columns…"
          className="mb-2 w-full rounded-lg border bg-transparent px-3 py-2 text-[14px] focus:outline-none"
          style={{ borderColor: 'var(--task-line)', color: 'var(--task-ink-1)' }}
        />

        <div className="flex items-center gap-4 px-1 pb-1.5">
          {selectedCount < totalCount && (
            <button
              type="button"
              onClick={onSelectAll}
              className="text-[11px] uppercase tracking-[0.06em] font-medium"
              style={{ color: 'var(--task-ink-3)' }}
            >
              Select all
            </button>
          )}
          {selectedCount > 0 && (
            <button
              type="button"
              onClick={onClearAll}
              className="text-[11px] uppercase tracking-[0.06em] font-medium"
              style={{ color: 'var(--task-ink-3)' }}
            >
              Clear
            </button>
          )}
        </div>

        {filtered.length === 0 ? (
          <p className="px-2.5 py-3 text-[13px]" style={{ color: 'var(--task-ink-3)' }}>
            No columns match
          </p>
        ) : (
          filtered.map((col) => (
            <TaskOptionRow
              key={col.id}
              selected={visibleColumnIds.has(col.id)}
              onSelect={() => onToggle(col.id)}
            >
              {col.name}
            </TaskOptionRow>
          ))
        )}
      </div>
    </AdaptivePicker>
  );
}
