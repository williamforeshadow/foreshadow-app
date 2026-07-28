'use client';

// Demo fixtures for the templates list. Public (/demo is auth-exempt) so the
// layout is browser-verifiable without a session.
//
// TemplatesList reads useDepartments() for the group order and glyphs, which
// throws outside a provider — so this supplies a mock context value, the same
// way the other /demo pages do. Templates come in as props, so no fetch stub
// is needed. Demo-only.

import { DepartmentsContext } from '@/lib/departmentsContext';
import TemplatesList, { type TemplateListItem } from '@/components/templates/TemplatesList';
import type { Department } from '@/lib/types';

const DEPARTMENTS: Department[] = [
  { id: 'd1', name: 'Housekeeping', icon: 'spray-can', created_at: '', updated_at: '' },
  { id: 'd2', name: 'Maintenance', icon: 'wrench', created_at: '', updated_at: '' },
  { id: 'd3', name: 'Inspections', icon: 'clipboard-check', created_at: '', updated_at: '' },
  // No templates — still has to appear in the picker.
  { id: 'd4', name: 'Landscaping', icon: 'trees', created_at: '', updated_at: '' },
];

const DEPTS_VALUE = {
  departments: DEPARTMENTS,
  loading: false,
  deptIconMap: Object.fromEntries(DEPARTMENTS.map((d) => [d.id, d.icon])),
  refreshDepartments: async () => {},
};

function template(
  id: string,
  name: string,
  dept: Department | null,
  description: string | null,
  fieldCount: number,
  updated: string,
): TemplateListItem {
  return {
    id,
    name,
    department_id: dept?.id ?? null,
    department_name: dept?.name ?? null,
    description,
    fields: Array.from({ length: fieldCount }, (_, i) => ({ id: `${id}-f${i}` })),
    created_at: updated,
    updated_at: updated,
  };
}

const [HK, MAINT, INSP] = DEPARTMENTS; // DEPARTMENTS[3] (Landscaping) is intentionally unused.

const TEMPLATES: TemplateListItem[] = [
  template('t1', 'Turnover clean', HK, 'Standard between-guest reset.', 14, '2026-07-20T00:00:00Z'),
  template('t2', 'Deep clean', HK, 'Quarterly, adds appliances and baseboards.', 22, '2026-07-02T00:00:00Z'),
  template('t3', 'Linen swap', HK, null, 6, '2026-06-11T00:00:00Z'),
  template('t4', 'Quarterly HVAC service', MAINT, 'Filter, coils, condensate line.', 9, '2026-07-25T00:00:00Z'),
  template('t5', 'Pool chemical check', MAINT, null, 5, '2026-05-30T00:00:00Z'),
  template('t6', 'Pre-arrival inspection', INSP, 'Walkthrough before guest check-in.', 18, '2026-07-24T00:00:00Z'),
  // Department deleted since the template was authored — exercises the
  // fallback that names the group from the template's own field.
  template('t7', 'Legacy safety audit', { id: 'd9', name: 'Compliance', icon: 'shield', created_at: '', updated_at: '' }, null, 11, '2026-04-01T00:00:00Z'),
  // No department at all — exercises the Uncategorized bucket.
  template('t8', 'Owner walkthrough', null, 'Ad-hoc, used for owner visits.', 7, '2026-07-18T00:00:00Z'),
];

export default function TemplatesListDemoPage() {
  return (
    <DepartmentsContext.Provider value={DEPTS_VALUE}>
      <div className="h-screen">
        <TemplatesList templates={TEMPLATES} loading={false} />
      </div>
    </DepartmentsContext.Provider>
  );
}
