'use client';

import { Search, ArrowDown, ArrowUp } from 'lucide-react';

export type ConversationSort = 'newest' | 'oldest';

/**
 * Search + sort controls above the conversation list. Search filters by guest
 * name only; the sort toggle flips newest-first / oldest-first by last activity.
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
        className="inline-flex items-center gap-1 text-[11px] font-medium text-neutral-500 transition-colors hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-white"
        title="Toggle sort order"
      >
        {sort === 'newest' ? (
          <ArrowDown className="h-3.5 w-3.5" />
        ) : (
          <ArrowUp className="h-3.5 w-3.5" />
        )}
        {sort === 'newest' ? 'Newest first' : 'Oldest first'}
      </button>
    </div>
  );
}
