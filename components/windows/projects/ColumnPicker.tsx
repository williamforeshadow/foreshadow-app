'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';

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
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent | TouchEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [open]);

  const filtered = useMemo(() => {
    if (!search.trim()) return columns;
    const lower = search.toLowerCase();
    return columns.filter(c => c.name.toLowerCase().includes(lower));
  }, [columns, search]);

  const selectedCount = visibleColumnIds.size;
  const totalCount = columns.length;

  // Pill aesthetic matches the Boards pill + the schedule-page filter chips:
  // soft purple highlight when any column is filtered out, neutral otherwise.
  const restricted = selectedCount > 0 && selectedCount < totalCount;
  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen(!open)}
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

      {open && (
        <div
          ref={popoverRef}
          className="absolute right-0 top-full mt-1.5 w-64 z-50 rounded-xl glass-card bg-white/[0.97] dark:bg-card/[0.98] border border-white/30 dark:border-white/15"
        >
          <div className="relative overflow-hidden rounded-xl glass-sheen">
            {/* Search */}
            <div className="p-2 border-b border-neutral-200/60 dark:border-white/10">
              <input
                type="text"
                placeholder="Search columns..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-neutral-200/60 dark:border-white/10 text-neutral-900 dark:text-white placeholder-neutral-400 dark:placeholder-neutral-500 outline-none focus:border-neutral-300 dark:focus:border-white/20"
              />
            </div>

            {/* Select All / Clear All */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-200/60 dark:border-white/10">
              <button
                onClick={onSelectAll}
                className="text-xs font-medium text-blue-500 hover:text-blue-400 transition-colors"
              >
                Select All
              </button>
              <button
                onClick={onClearAll}
                className="text-xs font-medium text-neutral-400 hover:text-neutral-300 transition-colors"
              >
                Clear All
              </button>
            </div>

            {/* Column list */}
            <div className="max-h-64 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <p className="text-sm text-neutral-400 dark:text-neutral-500 text-center py-3">No columns match</p>
              ) : (
                filtered.map((col) => {
                  const isChecked = visibleColumnIds.has(col.id);
                  return (
                    <button
                      key={col.id}
                      onClick={() => onToggle(col.id)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors text-left"
                    >
                      <div
                        className={`w-4.5 h-4.5 rounded flex-shrink-0 border flex items-center justify-center transition-colors ${
                          isChecked
                            ? 'bg-blue-500 border-blue-500'
                            : 'border-neutral-300 dark:border-white/20 bg-transparent'
                        }`}
                      >
                        {isChecked && (
                          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                      <span className={`truncate ${isChecked ? 'text-neutral-900 dark:text-white' : 'text-neutral-400 dark:text-neutral-500'}`}>
                        {col.name}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
