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
  /** Open the panel. An optional prompt is auto-submitted on open — used by the
   *  mobile compose-then-open flow so the panel appears mid-conversation. */
  open: (initialPrompt?: string) => void;
  close: () => void;
  toggle: () => void;
  toggleFullscreen: () => void;
  /** A prompt handed to open() that the panel should submit once, then clear. */
  pendingPrompt: string | null;
  clearPendingPrompt: () => void;
}

// Exported so the isolated marketing demo (app/demo/*) can supply an
// always-open value to the real AiChatPanel. Inert for existing importers.
export const AiChatContext = createContext<AiChatContextValue | undefined>(undefined);

export function AiChatProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);

  const open = useCallback((initialPrompt?: string) => {
    if (initialPrompt && initialPrompt.trim()) setPendingPrompt(initialPrompt);
    setIsOpen(true);
  }, []);
  const close = useCallback(() => setIsOpen(false), []);
  const clearPendingPrompt = useCallback(() => setPendingPrompt(null), []);
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
    () => ({
      isOpen,
      isFullscreen,
      open,
      close,
      toggle,
      toggleFullscreen,
      pendingPrompt,
      clearPendingPrompt,
    }),
    [isOpen, isFullscreen, open, close, toggle, toggleFullscreen, pendingPrompt, clearPendingPrompt],
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
