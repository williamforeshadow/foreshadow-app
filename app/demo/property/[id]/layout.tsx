'use client';

// =============================================================================
// PUBLIC MARKETING DEMO — the real Property Profile (PropertyShell + the real
// Knowledge / Tasks / Schedule sections), fully mocked. The nested demo routes
// under this layout re-export the real property pages; this layout supplies the
// mock context providers + a module-scope window.fetch interceptor so NO request
// reaches the backend. Read-only. One property: 425 W Beech St #1404.
// =============================================================================

import { useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import { AuthContext, type Role } from '@/lib/authContext';
import { DepartmentsContext } from '@/lib/departmentsContext';
import {
  OperationsSettingsContext,
  DEFAULT_SETTINGS,
} from '@/lib/operationsSettingsContext';
import { ReservationViewerContext, NOOP_VALUE } from '@/lib/reservationViewerContext';
import { PropertyShell } from '@/components/properties/PropertyShell';
import { useDemoGuards } from '../../useDemoGuards';
import {
  DEMO_USER,
  DEMO_USERS,
  DEMO_DEPARTMENTS,
  DEMO_DEPT_ICON_MAP,
} from '../../schedule/demoScheduleData';
import {
  DEMO_PROPERTY,
  getDemoAccess,
  getDemoConnectivity,
  getDemoTechAccounts,
  getDemoRooms,
  getDemoContacts,
  getDemoNotes,
  getDemoDocuments,
  getDemoPropertyTasks,
  getDemoPropertySchedule,
} from '../demoPropertyData';

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

function makeMockFetch(original: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input);
    const method = (init?.method || 'GET').toUpperCase();

    // Property profile endpoints — GETs return fabricated data; everything else
    // (mutations) falls through to the benign catch-all.
    if (url.includes('/api/properties/') && method === 'GET') {
      if (url.includes('/access')) return json({ access: getDemoAccess() });
      if (url.includes('/connectivity')) return json({ connectivity: getDemoConnectivity() });
      if (url.includes('/tech-accounts')) return json({ accounts: getDemoTechAccounts() });
      if (url.includes('/rooms')) {
        const scope = url.includes('scope=exterior') ? 'exterior' : 'interior';
        await delay(80);
        return json({ rooms: getDemoRooms(scope) });
      }
      if (url.includes('/contacts')) return json({ contacts: getDemoContacts() });
      if (url.includes('/knowledge/activity')) return json({ activities: [], hasMore: false });
      if (url.includes('/notes')) return json({ notes: getDemoNotes() });
      if (url.includes('/documents')) return json({ documents: getDemoDocuments() });
      if (url.includes('/tasks')) {
        await delay(80);
        return json(getDemoPropertyTasks());
      }
      if (url.includes('/schedule')) {
        await delay(80);
        return json(getDemoPropertySchedule());
      }
      // Bare property fetch (PropertyProvider): /api/properties/:id
      return json({ property: DEMO_PROPERTY });
    }
    if (url.includes('/api/properties') && method === 'GET') {
      // Property list (used by some filter dropdowns).
      return json({ properties: [{ id: DEMO_PROPERTY.id, name: DEMO_PROPERTY.name }] });
    }

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
  const w = window as Window & { __demoPropPatched?: boolean };
  if (w.__demoPropPatched) return;
  savedFetch = window.fetch.bind(window);
  window.fetch = makeMockFetch(savedFetch);
  w.__demoPropPatched = true;
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
  canEditProperties: true,
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

export default function DemoPropertyLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ id: string }>();
  const id = (params?.id as string) || DEMO_PROPERTY.id;
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    installInterceptor();
    return () => {
      const w = window as Window & { __demoPropPatched?: boolean };
      if (savedFetch && w.__demoPropPatched) {
        window.fetch = savedFetch;
        w.__demoPropPatched = false;
      }
    };
  }, []);

  // Read-only: block edits, uploads, and out-of-/demo navigation.
  useDemoGuards(stageRef);

  return (
    <div
      ref={stageRef}
      style={{ height: '100dvh', background: 'var(--card)', overflow: 'hidden' }}
    >
      {/* This demo is embedded cropped on the marketing site — hide all
          scrollbars so no scroll track shows inside the showcase cards. */}
      <style>{`
        ::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }
        * { scrollbar-width: none !important; -ms-overflow-style: none !important; }
      `}</style>
      <AuthContext.Provider value={AUTH_VALUE}>
        <DepartmentsContext.Provider value={DEPTS_VALUE}>
          <OperationsSettingsContext.Provider value={OPS_VALUE}>
            <ReservationViewerContext.Provider value={NOOP_VALUE}>
              <PropertyShell propertyId={id} basePath={`/demo/property/${id}`}>
                {children}
              </PropertyShell>
            </ReservationViewerContext.Provider>
          </OperationsSettingsContext.Provider>
        </DepartmentsContext.Provider>
      </AuthContext.Provider>
    </div>
  );
}
