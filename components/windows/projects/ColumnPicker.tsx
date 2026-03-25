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

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
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
    return () => document.removeEventListener('mousedown', handleClickOutside);
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
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
        </svg>
        Columns
        <span className="text-neutral-400 dark:text-neutral-500">
          {selectedCount}/{totalCount}
        </span>
        <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute right-0 top-full mt-1 w-64 z-50 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-xl overflow-hidden"
        >
          {/* Search */}
          <div className="p-2 border-b border-neutral-200 dark:border-neutral-700">
            <input
              autoFocus
              type="text"
              placeholder="Search columns..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-white placeholder-neutral-400 dark:placeholder-neutral-500 outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
            />
          </div>

          {/* Select All / Clear All */}
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-neutral-200 dark:border-neutral-700">
            <button
              onClick={onSelectAll}
              className="text-[11px] font-medium text-blue-500 hover:text-blue-400 transition-colors"
            >
              Select All
            </button>
            <button
              onClick={onClearAll}
              className="text-[11px] font-medium text-neutral-400 hover:text-neutral-300 transition-colors"
            >
              Clear All
            </button>
          </div>

          {/* Column list */}
          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="text-xs text-neutral-500 text-center py-3">No columns match</p>
            ) : (
              filtered.map((col) => {
                const isChecked = visibleColumnIds.has(col.id);
                return (
                  <button
                    key={col.id}
                    onClick={() => onToggle(col.id)}
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors text-left"
                  >
                    <div
                      className={`w-4 h-4 rounded flex-shrink-0 border flex items-center justify-center transition-colors ${
                        isChecked
                          ? 'bg-blue-500 border-blue-500'
                          : 'border-neutral-300 dark:border-neutral-600 bg-transparent'
                      }`}
                    >
                      {isChecked && (
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    <span className={`truncate ${isChecked ? 'text-neutral-900 dark:text-white' : 'text-neutral-500 dark:text-neutral-400'}`}>
                      {col.name}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
