'use client';

import { Search, ArrowDown, ArrowUp } from 'lucide-react';

export type ConversationSort = 'newest' | 'oldest';

/**
 * Search bar (guest names) + a boxed sort-direction toggle (arrow only).
 */
export function ConversationListControls({
  query,
  onQueryChange,
  sort,
  onToggleSort,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  sort: ConversationSort;
  onToggleSort: () => void;
}) {
  return (
    <div className="shrink-0 space-y-2 px-3 pb-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search guests"
          className="w-full rounded-md border border-[var(--surface-elevated-divider)] bg-transparent py-1.5 pl-8 pr-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-300 dark:text-white dark:focus:ring-white/20"
        />
      </div>
      <button
        type="button"
        onClick={onToggleSort}
        title={sort === 'newest' ? 'Newest first' : 'Oldest first'}
        aria-label={`Sort: ${sort === 'newest' ? 'newest first' : 'oldest first'}`}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--surface-elevated-divider)] text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-white"
      >
        {sort === 'newest' ? (
          <ArrowDown className="h-4 w-4" />
        ) : (
          <ArrowUp className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}
