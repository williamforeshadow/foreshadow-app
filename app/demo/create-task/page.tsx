'use client';

// Demo fixtures for the create-task interface. Public (/demo is auth-exempt)
// so the form is browser-verifiable without a session. The picker lists
// (properties, templates, bins) are seeded straight into the React Query cache
// and departments via the context's mock hook, so nothing hits the API.
// Submitting still POSTs for real — that part needs a logged-in session.

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/queries';
import type { Department, ProjectBin, PropertyOption } from '@/lib/types';
import { DepartmentsContext } from '@/lib/departmentsContext';
import { CreateTaskPanel } from '@/components/tasks/create/CreateTaskPanel';

const DEMO_DEPARTMENTS: Department[] = [
  { id: 'dept-clean', name: 'Housekeeping', icon: 'spray-can', created_at: '', updated_at: '' },
  { id: 'dept-maint', name: 'Maintenance', icon: 'wrench', created_at: '', updated_at: '' },
  { id: 'dept-inspect', name: 'Inspections', icon: 'clipboard-check', created_at: '', updated_at: '' },
  { id: 'dept-land', name: 'Landscaping', icon: 'trees', created_at: '', updated_at: '' },
];

const DEMO_PROPERTIES: PropertyOption[] = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Cortez Hill · 4B' },
  { id: '22222222-2222-4222-8222-222222222222', name: '1154 Diamond St PB' },
  { id: '33333333-3333-4333-8333-333333333333', name: 'Mission Bay Loft' },
];

const DEMO_TEMPLATES = [
  { id: '44444444-4444-4444-8444-444444444444', name: 'Turnover clean' },
  { id: '55555555-5555-4555-8555-555555555555', name: 'Deep clean' },
  { id: '66666666-6666-4666-8666-666666666666', name: 'Pre-arrival inspection' },
];

const DEMO_BINS: ProjectBin[] = [
  { id: '77777777-7777-4777-8777-777777777777', name: 'Task Bin', sort_order: 0, is_system: true, created_at: '', updated_at: '' },
  { id: '88888888-8888-4888-8888-888888888888', name: 'Linens bin', sort_order: 1, created_at: '', updated_at: '' },
  { id: '99999999-9999-4999-8999-999999999999', name: 'Turo prep', sort_order: 2, created_at: '', updated_at: '' },
];

export default function CreateTaskDemoPage() {
  const queryClient = useQueryClient();
  const [seedKey, setSeedKey] = useState<'blank' | 'property' | 'template'>('blank');
  const [lastCreated, setLastCreated] = useState<string | null>(null);

  // `?live=1` skips the fixtures so an authenticated session loads real
  // properties/templates/bins/departments — the only way to exercise a true
  // end-to-end create, since the fixture ids aren't real rows.
  const live =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('live');

  // Seed during render so the panel's hooks read cache instead of fetching.
  if (!live && !queryClient.getQueryData(qk.properties)) {
    queryClient.setQueryData(qk.properties, DEMO_PROPERTIES);
    queryClient.setQueryData(qk.taskTemplates, DEMO_TEMPLATES);
    queryClient.setQueryData(qk.projectBins, { bins: DEMO_BINS, totalProjects: 0 });
  }

  const seed =
    seedKey === 'property'
      ? { property_id: DEMO_PROPERTIES[1].id, property_name: DEMO_PROPERTIES[1].name }
      : seedKey === 'template'
        ? { template_id: DEMO_TEMPLATES[0].id, template_name: DEMO_TEMPLATES[0].name }
        : {};

  return (
    <div className="flex h-screen flex-col bg-neutral-100 dark:bg-[#0F0F12]">
      {/* Above the panel's modal backdrop, which covers the viewport. */}
      <div className="relative z-[60] flex shrink-0 items-center gap-2 p-3">
        {(['blank', 'property', 'template'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setSeedKey(k)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              k === seedKey
                ? 'border-transparent bg-[var(--accent-3)] text-white'
                : 'border-neutral-300 text-neutral-500 dark:border-[rgba(255,255,255,0.1)]'
            }`}
          >
            {k === 'blank' ? 'Blank' : k === 'property' ? 'Seeded property' : 'Seeded template'}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-neutral-400">
          demo — pickers are local, submit needs a session
          {lastCreated ? ` · last: ${lastCreated}` : ''}
        </span>
      </div>

      {live ? (
        // Real DepartmentsProvider from the app shell supplies departments.
        <CreateTaskPanel
          key={seedKey}
          seed={seed}
          onClose={() => {}}
          onCreated={(t) => setLastCreated(String(t.id))}
        />
      ) : (
        <DepartmentsContext.Provider
          value={{
            departments: DEMO_DEPARTMENTS,
            loading: false,
            deptIconMap: Object.fromEntries(DEMO_DEPARTMENTS.map((d) => [d.id, d.icon])),
            refreshDepartments: async () => {},
          }}
        >
          <CreateTaskPanel
            key={seedKey}
            seed={seed}
            onClose={() => {}}
            onCreated={(t) => setLastCreated(String(t.id))}
          />
        </DepartmentsContext.Provider>
      )}
    </div>
  );
}
