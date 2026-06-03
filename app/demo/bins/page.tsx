'use client';

// =============================================================================
// PUBLIC MARKETING DEMO — the real Bins/Boards (ProjectsWindow), fully mocked.
// Same isolation pattern as app/demo/schedule: render the real component inside
// mock context providers + a window.fetch interceptor so NO request reaches the
// backend. Read-only; the Ask Foreshadow agent works here too.
// =============================================================================

import { useEffect, useRef, useState } from 'react';
import { useDemoGuards } from '../useDemoGuards';
import { AuthContext, type Role } from '@/lib/authContext';
import { DepartmentsContext } from '@/lib/departmentsContext';
import {
  OperationsSettingsContext,
  DEFAULT_SETTINGS,
} from '@/lib/operationsSettingsContext';
import { ReservationViewerContext, NOOP_VALUE } from '@/lib/reservationViewerContext';
import ProjectsWindow from '@/components/windows/ProjectsWindow';
import { AiChatPanel } from '@/components/ai-chat/AiChatPanel';
import { useAiChat } from '@/components/ai-chat/AiChatProvider';
import {
  DEMO_USER,
  DEMO_USERS,
  DEMO_DEPARTMENTS,
  DEMO_DEPT_ICON_MAP,
  DEMO_PROPERTY_OPTIONS,
} from '../schedule/demoScheduleData';
import { DEMO_PROJECT_BINS, getDemoBinTasks } from './demoBinsData';

const SB = process.env.NEXT_PUBLIC_SUPABASE_URL || '';

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}
function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CANNED_ANSWER = [
  'Thanks for asking! If you like the feel of this, you should onboard with **Foreshadow** — I can help you and your operations with:',
  '',
  '- coordinating tasks',
  '- analyzing operations',
  '- fetching property knowledge',
  '',
  'How does that sound?',
].join('\n');

function makeMockFetch(original: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input);
    const method = (init?.method || 'GET').toUpperCase();

    if (url.includes('/api/agent')) {
      await delay(850);
      return json({ answer: CANNED_ANSWER });
    }
    if (url.includes('/api/project-bins')) {
      return json({ data: DEMO_PROJECT_BINS, total_projects: 27 });
    }
    // GET list of tasks for the board (mutations fall through to the catch-all)
    if (url.includes('/api/tasks-for-bin') && method === 'GET') {
      await delay(120);
      return json({ data: getDemoBinTasks() });
    }
    if (url.includes('/api/properties')) return json({ properties: DEMO_PROPERTY_OPTIONS });
    if (url.includes('/api/tasks')) return json({ data: [] });
    if (url.includes('/api/auth/me')) return json({ user: DEMO_USER });
    if (url.includes('/api/users')) return json({ data: DEMO_USERS });
    if (url.includes('/api/departments')) return json({ departments: [] });
    if (url.includes('/api/operations-settings')) return json({ settings: DEFAULT_SETTINGS });

    if (url.includes('/api/') || (SB && url.startsWith(SB))) {
      return json({ data: [], error: null });
    }
    return original(input, init);
  }) as typeof fetch;
}

let savedFetch: typeof fetch | null = null;
function installInterceptor() {
  if (typeof window === 'undefined') return;
  const w = window as Window & { __demoBinsPatched?: boolean };
  if (w.__demoBinsPatched) return;
  savedFetch = window.fetch.bind(window);
  window.fetch = makeMockFetch(savedFetch);
  w.__demoBinsPatched = true;
}
installInterceptor();

const AUTH_VALUE = {
  user: DEMO_USER,
  allUsers: DEMO_USERS,
  role: 'manager' as Role,
  loading: false,
  error: null,
  signOut: async () => {},
  refreshUser: async () => {},
  canManageUsers: false,
  canEditTemplates: true,
  canViewAllTasks: true,
  canEditTasks: true,
  canViewAllProperties: true,
  canEditProperties: false,
  canManageProjects: true,
};
const DEPTS_VALUE = {
  departments: DEMO_DEPARTMENTS,
  loading: false,
  deptIconMap: DEMO_DEPT_ICON_MAP,
  refreshDepartments: async () => {},
};
const OPS_VALUE = {
  settings: DEFAULT_SETTINGS,
  loading: false,
  error: null,
  migrationPending: false,
  refresh: async () => {},
  save: async () => ({ ok: true as const }),
};

function AgentLauncher() {
  const { open, isOpen } = useAiChat();
  if (isOpen) return null;
  return (
    <button
      type="button"
      onClick={open}
      style={{
        position: 'fixed',
        right: 22,
        bottom: 22,
        zIndex: 80,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '11px 17px',
        borderRadius: 999,
        border: 'none',
        cursor: 'pointer',
        fontSize: 13.5,
        fontWeight: 600,
        color: '#fff',
        background: '#6366f1',
        boxShadow: '0 10px 28px -8px rgba(99,102,241,0.7)',
      }}
    >
      ✦ Ask Foreshadow
    </button>
  );
}

export default function DemoBinsPage() {
  const stageRef = useRef<HTMLDivElement>(null);
  // Cover the bin-overview screen until the board is open, so the demo never
  // flashes the overview before landing on the populated Task Bin board.
  const [boardReady, setBoardReady] = useState(false);

  useEffect(() => {
    installInterceptor();
    return () => {
      const w = window as Window & { __demoBinsPatched?: boolean };
      if (savedFetch && w.__demoBinsPatched) {
        window.fetch = savedFetch;
        w.__demoBinsPatched = false;
      }
    };
  }, []);

  // Read-only guards (block task-detail open, contenteditable edits, nav, etc.).
  useDemoGuards(stageRef);

  // ProjectsWindow opens on a bin OVERVIEW; click the system "Task Bin" card so
  // the demo lands straight on the populated board. (No way to set the
  // component's internal showKanban state without editing it.) Reveal only once
  // the kanban board has mounted — the overlay hides the overview underneath.
  useEffect(() => {
    let tries = 0;
    const id = window.setInterval(() => {
      tries += 1;
      if (document.querySelector('[data-kanban-board]')) {
        setBoardReady(true);
        window.clearInterval(id);
        return;
      }
      const card = Array.from(
        document.querySelectorAll<HTMLElement>('[role="button"]'),
      ).find((c) => /task bin/i.test(c.textContent || '') && /\btasks?\b/i.test(c.textContent || ''));
      if (card) card.click();
      if (tries > 90) {
        setBoardReady(true);
        window.clearInterval(id);
      }
    }, 60);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div
      ref={stageRef}
      style={{ height: '100dvh', background: 'var(--background)', overflow: 'hidden' }}
    >
      {!boardReady && (
        <div
          aria-hidden
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 85,
            background: 'var(--background)',
          }}
        />
      )}
      <AuthContext.Provider value={AUTH_VALUE}>
        <DepartmentsContext.Provider value={DEPTS_VALUE}>
          <OperationsSettingsContext.Provider value={OPS_VALUE}>
            <ReservationViewerContext.Provider value={NOOP_VALUE}>
              <div style={{ height: '100%' }}>
                <ProjectsWindow users={DEMO_USERS} currentUser={DEMO_USER} />
              </div>
              <AiChatPanel />
              <AgentLauncher />
            </ReservationViewerContext.Provider>
          </OperationsSettingsContext.Provider>
        </DepartmentsContext.Provider>
      </AuthContext.Provider>
    </div>
  );
}
