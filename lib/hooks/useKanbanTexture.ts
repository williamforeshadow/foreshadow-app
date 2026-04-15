'use client';

import { useState, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'foreshadow_kanban_texture';

/**
 * Manages the kanban board background texture preference.
 * Persists to localStorage. Defaults to enabled.
 */
export function useKanbanTexture() {
  const [enabled, setEnabled] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored !== null) {
        setEnabled(stored === 'true');
      }
    } catch {
      // ignore
    }
    setMounted(true);
  }, []);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // storage full
      }
      return next;
    });
  }, []);

  return { enabled: mounted ? enabled : true, toggle, mounted };
}
