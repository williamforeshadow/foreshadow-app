'use client';

// Demo fixtures for the departments list. Public (/demo is auth-exempt) so the
// layout is browser-verifiable without a session.
//
// The page reads useDepartments() and renders inside DesktopSidebarShell, whose
// sidebar needs auth — so both contexts are mocked here, the same way the other
// /demo pages do. Create/edit/delete still hit the real API and will 401; this
// fixture is for layout only. Demo-only.

import { DepartmentsContext } from '@/lib/departmentsContext';
import DepartmentsPage from '@/app/departments/page';
import type { Department } from '@/lib/types';

const DEPARTMENTS: Department[] = [
  { id: 'd1', name: 'Housekeeping', icon: 'spray-can', created_at: '', updated_at: '' },
  { id: 'd2', name: 'Maintenance', icon: 'wrench', created_at: '', updated_at: '' },
  { id: 'd3', name: 'Inspections', icon: 'clipboard-check', created_at: '', updated_at: '' },
  { id: 'd4', name: 'Landscaping', icon: 'trees', created_at: '', updated_at: '' },
  { id: 'd5', name: 'Guest Care', icon: 'heart', created_at: '', updated_at: '' },
];

const DEPTS_VALUE = {
  departments: DEPARTMENTS,
  loading: false,
  deptIconMap: Object.fromEntries(DEPARTMENTS.map((d) => [d.id, d.icon])),
  refreshDepartments: async () => {},
};

export default function DepartmentsListDemoPage() {
  return (
    <DepartmentsContext.Provider value={DEPTS_VALUE}>
      <DepartmentsPage />
    </DepartmentsContext.Provider>
  );
}
