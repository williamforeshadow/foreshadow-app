'use client';

// Demo fixture for the template editor. Public (/demo is auth-exempt) so the
// layout is browser-verifiable without a session.
//
// TemplateEditor reads useDepartments() for the department picker, which throws
// outside a provider — so this supplies a mock context value, the same way the
// other /demo pages do. Everything else comes in as props; the save/delete
// fetches only fire on submit, which this page never does. Demo-only.

import { DepartmentsContext } from '@/lib/departmentsContext';
import TemplateEditor from '@/components/templates/TemplateEditor';
import type { Department } from '@/lib/types';

const DEPARTMENTS: Department[] = [
  { id: 'd1', name: 'Housekeeping', icon: 'spray-can', created_at: '', updated_at: '' },
  { id: 'd2', name: 'Maintenance', icon: 'wrench', created_at: '', updated_at: '' },
  { id: 'd3', name: 'Inspections', icon: 'clipboard-check', created_at: '', updated_at: '' },
];

const DEPTS_VALUE = {
  departments: DEPARTMENTS,
  loading: false,
  deptIconMap: Object.fromEntries(DEPARTMENTS.map((d) => [d.id, d.icon])),
  refreshDepartments: async () => {},
};

const FIELDS = [
  { id: 'f1', type: 'separator' as const, label: 'Kitchen', required: false },
  { id: 'f2', type: 'checkbox' as const, label: 'Counters wiped', required: true },
  { id: 'f3', type: 'photos' as const, label: 'Photos of the sink area', required: true },
  { id: 'f4', type: 'separator' as const, label: 'Bathroom', required: false },
  { id: 'f5', type: 'rating' as const, label: 'Overall cleanliness', required: false },
  { id: 'f6', type: 'text' as const, label: '', required: false },
];

export default function TemplateEditorDemoPage() {
  return (
    <DepartmentsContext.Provider value={DEPTS_VALUE}>
      <TemplateEditor
        templateId="t1"
        initialName="Turnover clean"
        initialDepartmentId="d1"
        initialDescription="Standard between-guest reset."
        initialFields={FIELDS}
      />
    </DepartmentsContext.Provider>
  );
}
