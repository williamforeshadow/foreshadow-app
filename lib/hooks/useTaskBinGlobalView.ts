'use client';

import { useState, useCallback, useEffect } from 'react';

// localStorage key for the Task Bin's "Global" toggle. Persisting it means
// the user's last preference survives navigation away from / back to the
// Task Bin and full page reloads — same UX as useKanbanTexture and
// useColumnVisibility.
const STORAGE_KEY = 'foreshadow_task_bin_global_view';

/**
 * Persists the Task Bin's "Global" toggle.
 *
 * Default OFF: the Task Bin shows orphan binned tasks only (is_binned=true
 * AND bin_id IS NULL — the system bin's natural contents).
 *
 * When ON: the Task Bin widens to show every binned task across the Task
 * Bin and every sub-bin. The kanban consumer is responsible for fetching
 * with bin_id='__every__' (vs the default Task-Bin-only fetch) when this
 * toggle is on. This is the user-facing replacement for the old "All Bins"
 * tile / sentinel in the bins picker.
 *
 * `mounted` mirrors useKanbanTexture's pattern: we render the OFF default
 * during SSR / before localStorage hydration to avoid markup mismatch, and
 * the consumer can defer interactive UI until mounted=true if it wants.
 */
export function useTaskBinGlobalView() {
  const [enabled, setEnabled] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored !== null) {
        setEnabled(stored === 'true');
      }
    } catch {
      // ignore (private mode, quota, etc.)
    }
    setMounted(true);
  }, []);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  return { enabled: mounted ? enabled : false, toggle, mounted };
}
