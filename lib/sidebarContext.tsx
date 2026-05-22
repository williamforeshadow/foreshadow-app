'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

// Persistence key. The sidebar is closed (off) by default; pinning it sticks
// across reloads. A fresh key (vs the old `foreshadow.sidebarOpen`) ensures
// existing users also land on the new off-by-default behavior.
const SIDEBAR_PINNED_STORAGE_KEY = 'foreshadow.sidebarPinned';

interface SidebarContextValue {
  /** True when the sidebar is pinned open (reserves layout width). */
  isPinned: boolean;
  pin: () => void;
  unpin: () => void;
  togglePinned: () => void;
  /**
   * Becomes `true` one frame after we hydrate from localStorage. Consumers
   * gate width / transform transitions on this so the initial paint snaps
   * into place rather than animating from the SSR default state.
   */
  isReady: boolean;
}

const SidebarContext = createContext<SidebarContextValue | undefined>(undefined);

export function SidebarProvider({ children }: { children: ReactNode }) {
  // Default closed (unpinned). The SSR HTML matches this; we hydrate the
  // stored preference in an effect to avoid hydration mismatches.
  const [isPinned, setIsPinned] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const stored =
      typeof window !== 'undefined'
        ? window.localStorage.getItem(SIDEBAR_PINNED_STORAGE_KEY)
        : null;

    // Defer enabling transitions to next frame so the initial state snaps
    // rather than animating from the default.
    const id = requestAnimationFrame(() => {
      if (stored === 'true') {
        setIsPinned(true);
      }
      setIsReady(true);
    });
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (isReady) {
      window.localStorage.setItem(SIDEBAR_PINNED_STORAGE_KEY, String(isPinned));
    }
  }, [isPinned, isReady]);

  // Expose the pinned sidebar width as a CSS variable so app-wide chrome
  // (the full-screen AI chat panel) can align to the content area. Hover-peek
  // is an overlay, so only the pinned state changes the content width.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.style.setProperty(
      '--app-sidebar-width',
      isPinned ? '256px' : '0px',
    );
  }, [isPinned]);

  const pin = useCallback(() => setIsPinned(true), []);
  const unpin = useCallback(() => setIsPinned(false), []);
  const togglePinned = useCallback(() => setIsPinned((p) => !p), []);

  return (
    <SidebarContext.Provider
      value={{ isPinned, pin, unpin, togglePinned, isReady }}
    >
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar(): SidebarContextValue {
  const ctx = useContext(SidebarContext);
  if (!ctx) {
    throw new Error('useSidebar must be used within a SidebarProvider');
  }
  return ctx;
}
