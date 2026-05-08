'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '@/lib/authContext';

// Persistence key for the sidebar open/closed preference. Read on mount,
// written whenever the user toggles. Stored as a string so we can detect
// "never set" (null) vs explicit "false".
const SIDEBAR_STORAGE_KEY = 'foreshadow.sidebarOpen';
const SIDEBAR_SECTIONS_STORAGE_KEY = 'foreshadow.sidebarSections';

export type SidebarAssignment = {
  task_id?: string | null;
  id?: string | null;
  title?: string | null;
  template_name?: string | null;
};

export type SidebarProperty = {
  id: string;
  name: string;
};

export type SidebarFetchState = 'idle' | 'loading' | 'ready' | 'error';

type AssignmentResult = {
  userId: string | null;
  state: SidebarFetchState;
  tasks: SidebarAssignment[];
};

type PropertyResult = {
  state: SidebarFetchState;
  properties: SidebarProperty[];
};

interface SidebarContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  workspaceOpen: boolean;
  setWorkspaceOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  assignmentsOpen: boolean;
  setAssignmentsOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  propertiesOpen: boolean;
  setPropertiesOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  assignmentState: SidebarFetchState;
  assignments: SidebarAssignment[];
  propertyState: SidebarFetchState;
  properties: SidebarProperty[];
  /**
   * Becomes `true` one frame after we hydrate from localStorage. Consumers
   * gate width / opacity transitions on this so the initial paint snaps
   * into place rather than animating from the SSR default state.
   */
  isReady: boolean;
}

const SidebarContext = createContext<SidebarContextValue | undefined>(undefined);

export function SidebarProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const currentUserId = user?.id ?? null;
  // Default open. The SSR HTML matches this; we update from localStorage in
  // an effect to avoid hydration mismatches.
  const [isOpen, setIsOpen] = useState(true);
  const [workspaceOpen, setWorkspaceOpen] = useState(true);
  const [assignmentsOpen, setAssignmentsOpen] = useState(true);
  const [propertiesOpen, setPropertiesOpen] = useState(true);
  const [isReady, setIsReady] = useState(false);
  const [assignmentResult, setAssignmentResult] = useState<AssignmentResult>({
    userId: null,
    state: 'idle',
    tasks: [],
  });
  const [propertyResult, setPropertyResult] = useState<PropertyResult>({
    state: 'loading',
    properties: [],
  });

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
      assignmentsOpen: boolean;
      propertiesOpen: boolean;
    }> | null = null;
    if (storedSections) {
      try {
        parsedSections = JSON.parse(storedSections) as Partial<{
          workspaceOpen: boolean;
          assignmentsOpen: boolean;
          propertiesOpen: boolean;
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
        if (typeof parsedSections.assignmentsOpen === 'boolean') {
          setAssignmentsOpen(parsedSections.assignmentsOpen);
        }
        if (typeof parsedSections.propertiesOpen === 'boolean') {
          setPropertiesOpen(parsedSections.propertiesOpen);
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
        JSON.stringify({ workspaceOpen, assignmentsOpen, propertiesOpen })
      );
    }
  }, [assignmentsOpen, isReady, propertiesOpen, workspaceOpen]);

  useEffect(() => {
    let cancelled = false;

    if (!currentUserId) {
      queueMicrotask(() => {
        if (cancelled) return;
        setAssignmentResult({
          userId: null,
          state: 'idle',
          tasks: [],
        });
      });
      return () => {
        cancelled = true;
      };
    }

    const loadAssignments = async () => {
      setAssignmentResult((prev) => ({
        userId: currentUserId,
        state: prev.userId === currentUserId && prev.tasks.length > 0 ? prev.state : 'loading',
        tasks: prev.userId === currentUserId ? prev.tasks : [],
      }));

      try {
        const res = await fetch(`/api/my-assignments?user_id=${encodeURIComponent(currentUserId)}`);
        if (!res.ok) throw new Error('Failed to fetch assignments');
        const data = await res.json() as { tasks?: SidebarAssignment[] };
        if (cancelled) return;
        setAssignmentResult({
          userId: currentUserId,
          state: 'ready',
          tasks: Array.isArray(data.tasks) ? data.tasks : [],
        });
      } catch {
        if (cancelled) return;
        setAssignmentResult({
          userId: currentUserId,
          state: 'error',
          tasks: [],
        });
      }
    };

    loadAssignments();

    return () => {
      cancelled = true;
    };
  }, [currentUserId]);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/properties')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch properties');
        return res.json();
      })
      .then((data: { properties?: SidebarProperty[] }) => {
        if (cancelled) return;
        setPropertyResult({
          state: 'ready',
          properties: Array.isArray(data.properties) ? data.properties : [],
        });
      })
      .catch(() => {
        if (cancelled) return;
        setPropertyResult({
          state: 'error',
          properties: [],
        });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((o) => !o), []);
  const assignmentState: SidebarFetchState = !currentUserId
    ? 'idle'
    : assignmentResult.userId === currentUserId
      ? assignmentResult.state
      : 'loading';
  const assignments = assignmentResult.userId === currentUserId ? assignmentResult.tasks : [];

  return (
    <SidebarContext.Provider
      value={{
        isOpen,
        open,
        close,
        toggle,
        workspaceOpen,
        setWorkspaceOpen,
        assignmentsOpen,
        setAssignmentsOpen,
        propertiesOpen,
        setPropertiesOpen,
        assignmentState,
        assignments,
        propertyState: propertyResult.state,
        properties: propertyResult.properties,
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
