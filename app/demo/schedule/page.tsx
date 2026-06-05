'use client';

// =============================================================================
// PUBLIC MARKETING DEMO — the real Schedule (TimelineWindow), fully mocked.
//
// Renders the REAL components/windows/TimelineWindow.tsx (unmodified) with no
// sidebar and a small tab bar. ALL data is fabricated and served by a
// window.fetch interceptor so NO request ever reaches the backend / Supabase:
//   - the Schedule reads via supabase.rpc()/.select() (global fetch) → mocked;
//   - the root layout's providers fire /api/* on mount → mocked + catch-all.
// The patch is installed at MODULE SCOPE so it's up before any provider effect
// runs. Read-only: edit interactions are caught by the catch-all and no-op'd.
// =============================================================================

import { useEffect, useRef } from 'react';
import { useDemoGuards } from '../useDemoGuards';
import { useIsMobile } from '@/lib/useIsMobile';
import { MobileTimelineView } from '@/components/mobile';
import { AuthContext, type Role } from '@/lib/authContext';
import { DepartmentsContext } from '@/lib/departmentsContext';
import {
  OperationsSettingsContext,
  DEFAULT_SETTINGS,
} from '@/lib/operationsSettingsContext';
import { ReservationViewerContext, NOOP_VALUE } from '@/lib/reservationViewerContext';
import TimelineWindow from '@/components/windows/TimelineWindow';
import { AiChatPanel } from '@/components/ai-chat/AiChatPanel';
import { AgentDemoBridge } from '@/components/ai-chat/AgentDemoBridge';
import {
  DEMO_USER,
  DEMO_USERS,
  DEMO_PROPERTY_OPTIONS,
  DEMO_DEPARTMENTS,
  DEMO_DEPT_ICON_MAP,
  getDemoTurnovers,
  getDemoRecurringRows,
} from './demoScheduleData';

// ---------------------------------------------------------------------------
// fetch interceptor — installed at module scope (idempotent), restored on
// unmount. Returns fabricated data for every backend URL; reaches the network
// only for non-backend assets (_next/*, fonts, images).
// ---------------------------------------------------------------------------

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

// Canned marketing reply for the Ask Foreshadow agent (which is openable inside
// this demo via Cmd/Ctrl+K or the launcher button).
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

    // Ask Foreshadow agent → canned script
    if (url.includes('/api/agent')) {
      await delay(850);
      return json({ answer: CANNED_ANSWER });
    }

    // Supabase — the Schedule's data
    if (url.includes('/rest/v1/rpc/get_property_turnovers')) {
      await delay(150);
      return json(getDemoTurnovers());
    }
    if (url.includes('/rest/v1/turnover_tasks')) {
      await delay(150);
      return json(getDemoRecurringRows());
    }

    // Specific /api routes (nicer than the empty catch-all)
    if (url.includes('/api/properties')) return json({ properties: DEMO_PROPERTY_OPTIONS });
    if (url.includes('/api/tasks-for-bin')) return json({ data: [] });
    if (url.includes('/api/project-bins')) return json({ data: [], total_projects: 0 });
    if (url.includes('/api/auth/me')) return json({ user: DEMO_USER });
    if (url.includes('/api/users')) return json({ data: DEMO_USERS });
    if (url.includes('/api/departments')) return json({ departments: [] });
    if (url.includes('/api/operations-settings')) return json({ settings: DEFAULT_SETTINGS });

    // Catch-all: any API route or any Supabase host call → safe empty.
    // Guarantees nothing reaches the real backend.
    if (url.includes('/api/') || (SB && url.startsWith(SB))) {
      return json({ data: [], error: null });
    }

    // Non-backend assets fall through to the real network.
    return original(input, init);
  }) as typeof fetch;
}

let savedFetch: typeof fetch | null = null;

function installInterceptor() {
  if (typeof window === 'undefined') return;
  const w = window as Window & { __demoSchedPatched?: boolean };
  if (w.__demoSchedPatched) return;
  savedFetch = window.fetch.bind(window);
  window.fetch = makeMockFetch(savedFetch);
  w.__demoSchedPatched = true;
}

// Runs as soon as this client module is evaluated — before provider effects.
installInterceptor();

// ---------------------------------------------------------------------------
// mock context values
// ---------------------------------------------------------------------------

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

// Floating "Ask Foreshadow" launcher — opens the real agent panel (which reads
// the root AiChatProvider's open state, also toggled by Cmd/Ctrl+K).

export default function DemoSchedulePage() {
  const stageRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    installInterceptor();
    return () => {
      const w = window as Window & { __demoSchedPatched?: boolean };
      if (savedFetch && w.__demoSchedPatched) {
        window.fetch = savedFetch;
        w.__demoSchedPatched = false;
      }
    };
  }, []);

  // Read-only demo: swallow the actions that would mutate data or navigate out
  // of /demo (opening a task's detail panel, editing the description, creating a
  // task, deep links to authed routes) — those error against the mocked
  // backend. Shared capture-phase guards; no edit to TimelineWindow needed.
  useDemoGuards(stageRef);

  return (
    <div
      ref={stageRef}
      style={{ height: '100dvh', background: 'var(--background)', overflow: 'hidden' }}
    >
      <AuthContext.Provider value={AUTH_VALUE}>
        <DepartmentsContext.Provider value={DEPTS_VALUE}>
          <OperationsSettingsContext.Provider value={OPS_VALUE}>
            <ReservationViewerContext.Provider value={NOOP_VALUE}>
              <div style={{ height: '100%' }}>
                {isMobile === null ? null : isMobile ? (
                  <MobileTimelineView />
                ) : (
                  <TimelineWindow users={DEMO_USERS} currentUser={DEMO_USER} />
                )}
              </div>
              {/* Real agent — opens via the launcher or Cmd/Ctrl+K, replies
                  with the canned script (see the /api/agent interceptor). */}
              <AiChatPanel />
              <AgentDemoBridge />
            </ReservationViewerContext.Provider>
          </OperationsSettingsContext.Provider>
        </DepartmentsContext.Provider>
      </AuthContext.Provider>
    </div>
  );
}
