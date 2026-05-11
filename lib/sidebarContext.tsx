'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

// Persistence key for the sidebar open/closed preference. Read on mount,
// written whenever the user toggles. Stored as a string so we can detect
// "never set" (null) vs explicit "false".
const SIDEBAR_STORAGE_KEY = 'foreshadow.sidebarOpen';
const SIDEBAR_SECTIONS_STORAGE_KEY = 'foreshadow.sidebarSections';

interface SidebarContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  workspaceOpen: boolean;
  setWorkspaceOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  /**
   * Becomes `true` one frame after we hydrate from localStorage. Consumers
   * gate width / opacity transitions on this so the initial paint snaps
   * into place rather than animating from the SSR default state.
   */
  isReady: boolean;
}

const SidebarContext = createContext<SidebarContextValue | undefined>(undefined);

export function SidebarProvider({ children }: { children: ReactNode }) {
  // Default open. The SSR HTML matches this; we update from localStorage in
  // an effect to avoid hydration mismatches.
  const [isOpen, setIsOpen] = useState(true);
  const [workspaceOpen, setWorkspaceOpen] = useState(true);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const stored =
      typeof window !== 'undefined'
        ? window.localStorage.getItem(SIDEBAR_STORAGE_KEY)
        : null;

    const storedSections =
      typeof window !== 'undefined'
        ? window.localStorage.getItem(SIDEBAR_SECTIONS_STORAGE_KEY)
        : null;
    let parsedSections: Partial<{
      workspaceOpen: boolean;
    }> | null = null;
    if (storedSections) {
      try {
        parsedSections = JSON.parse(storedSections) as Partial<{
          workspaceOpen: boolean;
        }>;
      } catch {
        window.localStorage.removeItem(SIDEBAR_SECTIONS_STORAGE_KEY);
      }
    }

    // Defer enabling transitions to next frame so the initial state snaps
    // rather than animating from the default.
    const id = requestAnimationFrame(() => {
      if (stored === 'false') {
        setIsOpen(false);
      }
      if (parsedSections) {
        if (typeof parsedSections.workspaceOpen === 'boolean') {
          setWorkspaceOpen(parsedSections.workspaceOpen);
        }
      }
      setIsReady(true);
    });
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (isReady) {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(isOpen));
    }
  }, [isOpen, isReady]);

  useEffect(() => {
    if (isReady) {
      window.localStorage.setItem(
        SIDEBAR_SECTIONS_STORAGE_KEY,
        JSON.stringify({ workspaceOpen })
      );
    }
  }, [isReady, workspaceOpen]);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((o) => !o), []);

  return (
    <SidebarContext.Provider
      value={{
        isOpen,
        open,
        close,
        toggle,
        workspaceOpen,
        setWorkspaceOpen,
        isReady,
      }}
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
