'use client';

// Demo fixtures for the department detail page. Public (/demo is auth-exempt)
// so the layout is browser-verifiable without a session.
//
// Lives under a dynamic segment because the page reads its id from useParams —
// mounted at a static route it would never fire its load(). Auth and
// departments contexts are mocked (the page needs allUsers for the add-member
// picker and role for the manage gate), and GET /api/departments/:id is
// stubbed. Mutations still hit the real API and will 401. Demo-only.

import { DepartmentsContext } from '@/lib/departmentsContext';
import { AuthContext } from '@/lib/authContext';
import DepartmentDetailPage from '@/app/departments/[id]/page';
import type { AppUser, Role } from '@/lib/authContext';
import type { Department } from '@/lib/types';

const DEPARTMENTS: Department[] = [
  { id: 'd1', name: 'Housekeeping', icon: 'spray-can', created_at: '', updated_at: '' },
  { id: 'd2', name: 'Maintenance', icon: 'wrench', created_at: '', updated_at: '' },
];

const USERS: AppUser[] = [
  { id: 'u1', name: 'Ana Reyes', email: 'ana@example.com', role: 'manager' as Role },
  { id: 'u2', name: 'Ben Osei', email: 'ben@example.com', role: 'staff' as Role },
  { id: 'u3', name: 'Chloe Nguyen', email: 'chloe@example.com', role: 'staff' as Role },
  { id: 'u4', name: 'Diego Marín', email: 'diego@example.com', role: 'vendor' as Role },
  { id: 'u5', name: 'Priya Shah', email: 'priya@example.com', role: 'superadmin' as Role },
];

// First three are members; the rest populate the add-member picker.
const MEMBERS = USERS.slice(0, 3);

const DEPTS_VALUE = {
  departments: DEPARTMENTS,
  loading: false,
  deptIconMap: Object.fromEntries(DEPARTMENTS.map((d) => [d.id, d.icon])),
  refreshDepartments: async () => {},
};

const AUTH_VALUE = {
  user: USERS[0],
  allUsers: USERS,
  role: 'superadmin' as Role,
  loading: false,
  error: null,
  signOut: async () => {},
  refreshUser: async () => {},
  canManageUsers: true,
  canEditTemplates: true,
  canViewAllTasks: true,
  canEditTasks: true,
  canViewAllProperties: true,
  canEditProperties: true,
  canManageProjects: true,
};

let stubInstalled = false;

// Installed during render, not in an effect: child effects run before parent
// effects, so an effect here would land after the page has already fired its
// mount fetch. Idempotent via the module-level flag.
function installFetchStub() {
  if (stubInstalled || typeof window === 'undefined') return;
  stubInstalled = true;
  const real = window.fetch;
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (/\/api\/departments\/[^/]+$/.test(url) && (!init?.method || init.method === 'GET')) {
      return new Response(
        JSON.stringify({ department: DEPARTMENTS[1], members: MEMBERS }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return real(input as RequestInfo, init);
  }) as typeof window.fetch;
}

export default function DepartmentDetailDemoPage() {
  installFetchStub();

  return (
    <AuthContext.Provider value={AUTH_VALUE}>
      <DepartmentsContext.Provider value={DEPTS_VALUE}>
        <DepartmentDetailPage />
      </DepartmentsContext.Provider>
    </AuthContext.Provider>
  );
}
