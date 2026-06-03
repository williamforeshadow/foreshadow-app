'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

// Global state for the universal AI chat. Mounted once at the root so the
// open/full-screen state — and, because AiChatPanel stays mounted, the
// conversation — survive route navigation. Exposes a Cmd/Ctrl+K shortcut.

interface AiChatContextValue {
  isOpen: boolean;
  isFullscreen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  toggleFullscreen: () => void;
}

// Exported so the isolated marketing demo (app/demo/*) can supply an
// always-open value to the real AiChatPanel. Inert for existing importers.
export const AiChatContext = createContext<AiChatContextValue | undefined>(undefined);

export function AiChatProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((o) => !o), []);
  const toggleFullscreen = useCallback(() => setIsFullscreen((f) => !f), []);

  // Cmd+K / Ctrl+K toggles the panel from anywhere; Escape closes it.
  // preventDefault on the shortcut — Ctrl+K otherwise focuses the browser's
  // address/search bar.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        toggle();
        return;
      }
      if (e.key === 'Escape') {
        setIsOpen((o) => (o ? false : o));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggle]);

  const value = useMemo(
    () => ({ isOpen, isFullscreen, open, close, toggle, toggleFullscreen }),
    [isOpen, isFullscreen, open, close, toggle, toggleFullscreen],
  );

  return (
    <AiChatContext.Provider value={value}>{children}</AiChatContext.Provider>
  );
}

export function useAiChat(): AiChatContextValue {
  const ctx = useContext(AiChatContext);
  if (!ctx) {
    throw new Error('useAiChat must be used within an AiChatProvider');
  }
  return ctx;
}
