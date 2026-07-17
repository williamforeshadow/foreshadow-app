'use client';

// =============================================================================
// PUBLIC MARKETING DEMO — the real "My Assignments" (MyAssignmentsWindow), fully
// mocked. Same isolation pattern as the other /demo routes: render the real
// component inside mock context providers + a window.fetch interceptor so NO
// request reaches the backend. Read-only; the Ask Foreshadow agent works here.
// Shows one teammate's personal task queue (Maya Singh).
// =============================================================================

import { Suspense, useEffect, useRef } from 'react';
import { useDemoGuards } from '../useDemoGuards';
import { useIsMobile } from '@/lib/useIsMobile';
import { MobileMyAssignmentsView } from '@/components/mobile';
import { AuthContext, type Role } from '@/lib/authContext';
import { DepartmentsContext } from '@/lib/departmentsContext';
import {
  OperationsSettingsContext,
  DEFAULT_SETTINGS,
} from '@/lib/operationsSettingsContext';
import { ReservationViewerContext, NOOP_VALUE } from '@/lib/reservationViewerContext';
import MyAssignmentsWindow from '@/components/windows/MyAssignmentsWindow';
import { AiChatPanel } from '@/components/ai-chat/AiChatPanel';
import { AgentDemoBridge } from '@/components/ai-chat/AgentDemoBridge';
import {
  DEMO_USERS,
  DEMO_DEPARTMENTS,
  DEMO_DEPT_ICON_MAP,
  DEMO_PROPERTY_OPTIONS,
} from '../schedule/demoScheduleData';
import { DEMO_ASSIGNMENTS_USER, getDemoAssignments } from './demoAssignmentsData';

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

    if (url.includes('/api/agent')) {
      await delay(850);
      return json({ answer: CANNED_ANSWER });
    }
    if (url.includes('/api/my-assignments')) {
      await delay(140);
      return json(getDemoAssignments());
    }
    if (url.includes('/api/properties')) return json({ properties: DEMO_PROPERTY_OPTIONS });
    if (url.includes('/api/project-bins')) return json({ data: [], total_projects: 0 });
    if (url.includes('/api/tasks')) return json({ data: [] });
    if (url.includes('/api/auth/me')) return json({ user: DEMO_ASSIGNMENTS_USER });
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
  const w = window as Window & { __demoAssignPatched?: boolean };
  if (w.__demoAssignPatched) return;
  savedFetch = window.fetch.bind(window);
  window.fetch = makeMockFetch(savedFetch);
  w.__demoAssignPatched = true;
}
installInterceptor();

const AUTH_VALUE = {
  user: DEMO_ASSIGNMENTS_USER,
  allUsers: DEMO_USERS,
  role: 'staff' as Role,
  loading: false,
  error: null,
  signOut: async () => {},
  refreshUser: async () => {},
  canManageUsers: false,
  canEditTemplates: false,
  canViewAllTasks: true,
  canEditTasks: true,
  canViewAllProperties: true,
  canEditProperties: false,
  canManageProjects: false,
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

export default function DemoAssignmentsPage() {
  const stageRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    installInterceptor();
    return () => {
      const w = window as Window & { __demoAssignPatched?: boolean };
      if (savedFetch && w.__demoAssignPatched) {
        window.fetch = savedFetch;
        w.__demoAssignPatched = false;
      }
    };
  }, []);

  // Shared read-only guards (contenteditable, file uploads, links, create).
  useDemoGuards(stageRef);

  // A TaskRow is <div role="button" class="grid … cursor-pointer">. Clicking it
  // opens the task detail panel AND router.replace('/assignments?openTask=…'),
  // which would navigate the iframe out of /demo. Swallow the row click.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const block = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target?.closest?.('[role="button"][class*="grid"][class*="cursor-pointer"]')) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    el.addEventListener('click', block, true);
    return () => el.removeEventListener('click', block, true);
  }, []);

  return (
    <div
      ref={stageRef}
      style={{ height: '100dvh', background: 'var(--card)', overflow: 'hidden' }}
    >
      <AuthContext.Provider value={AUTH_VALUE}>
        <DepartmentsContext.Provider value={DEPTS_VALUE}>
          <OperationsSettingsContext.Provider value={OPS_VALUE}>
            <ReservationViewerContext.Provider value={NOOP_VALUE}>
              <div style={{ height: '100%' }}>
                <Suspense fallback={null}>
                  {isMobile === null ? null : isMobile ? (
                    <MobileMyAssignmentsView />
                  ) : (
                    <MyAssignmentsWindow users={DEMO_USERS} currentUser={DEMO_ASSIGNMENTS_USER} />
                  )}
                </Suspense>
              </div>
              <AiChatPanel />
              <AgentDemoBridge />
            </ReservationViewerContext.Provider>
          </OperationsSettingsContext.Provider>
        </DepartmentsContext.Provider>
      </AuthContext.Provider>
    </div>
  );
}
