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
}

export function ColumnPicker({
  columns,
  visibleColumnIds,
  onToggle,
  onSelectAll,
  onClearAll,
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

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl bg-white/30 dark:bg-white/[0.08] backdrop-blur-sm border border-white/20 dark:border-white/10 text-neutral-900 dark:text-white hover:bg-white/50 dark:hover:bg-white/[0.14] transition-all"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
        </svg>
        Columns
        <span className="text-neutral-400 dark:text-neutral-500">
          {selectedCount}/{totalCount}
        </span>
        <svg className={`w-3.5 h-3.5 opacity-50 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute right-0 top-full mt-1.5 w-64 z-50 rounded-xl glass-card bg-white/85 dark:bg-neutral-900/90 border border-white/30 dark:border-white/10"
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
