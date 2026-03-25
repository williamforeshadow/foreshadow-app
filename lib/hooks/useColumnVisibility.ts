'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';

const STORAGE_PREFIX = 'foreshadow_col_vis_';

/**
 * Manages which Kanban columns are visible.
 * Persists to localStorage keyed by binId + viewMode.
 * Defaults to showing ALL columns if no prior selection exists.
 */
export function useColumnVisibility(binId: string | null, viewMode: string) {
  const storageKey = `${STORAGE_PREFIX}${binId || 'all'}_${viewMode}`;

  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());
  const [initialized, setInitialized] = useState(false);

  // Load from localStorage on mount or when key changes
  useEffect(() => {
    setInitialized(false);
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const arr = JSON.parse(stored) as string[];
        setVisibleIds(new Set(arr));
        setInitialized(true);
      } else {
        // No stored selection → will be set when allColumnIds provided
        setVisibleIds(new Set());
        setInitialized(true);
      }
    } catch {
      setVisibleIds(new Set());
      setInitialized(true);
    }
  }, [storageKey]);

  // Persist to localStorage
  const persist = useCallback(
    (ids: Set<string>) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(Array.from(ids)));
      } catch {
        // storage full — ignore
      }
    },
    [storageKey]
  );

  /**
   * Initialize with default columns if no localStorage entry exists.
   * Called by the parent once columns are known.
   * Only sets defaults when there's no saved selection.
   */
  const initWithDefaults = useCallback(
    (allIds: string[]) => {
      if (!initialized) return;
      // If we loaded an empty set but there's no localStorage entry,
      // default to showing all columns
      const stored = localStorage.getItem(storageKey);
      if (!stored) {
        const all = new Set(allIds);
        setVisibleIds(all);
        persist(all);
      } else if (visibleIds.size === 0 && allIds.length > 0) {
        // Edge case: stored was empty array (user cleared all), keep it
      }
    },
    [initialized, storageKey, persist, visibleIds.size]
  );

  const toggle = useCallback(
    (columnId: string) => {
      setVisibleIds((prev) => {
        const next = new Set(prev);
        if (next.has(columnId)) {
          next.delete(columnId);
        } else {
          next.add(columnId);
        }
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const selectAll = useCallback(
    (allIds: string[]) => {
      const all = new Set(allIds);
      setVisibleIds(all);
      persist(all);
    },
    [persist]
  );

  const clearAll = useCallback(() => {
    const empty = new Set<string>();
    setVisibleIds(empty);
    persist(empty);
  }, [persist]);

  return {
    visibleIds,
    initialized,
    initWithDefaults,
    toggle,
    selectAll,
    clearAll,
  };
}
