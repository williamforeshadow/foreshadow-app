'use client';

// Demo fixtures for the Task Automations page. Public (/demo is auth-exempt)
// so the layout is browser-verifiable without a session.
//
// AutomationsView fetches /api/property-templates itself, which 401s without a
// session — so this page installs a scoped fetch stub for that one endpoint
// before mounting, and restores the real fetch on unmount. Demo-only.

import AutomationsView from '@/components/templates/AutomationsView';

const TEMPLATES = [
  { id: 't1', name: 'Turnover clean', department_id: 'd1', department_name: 'Housekeeping', description: null },
  { id: 't2', name: 'Deep clean', department_id: 'd1', department_name: 'Housekeeping', description: null },
  { id: 't3', name: 'Quarterly HVAC service', department_id: 'd2', department_name: 'Maintenance', description: null },
  { id: 't4', name: 'Pre-arrival inspection', department_id: 'd3', department_name: 'Inspections', description: null },
];

const PROPERTIES = [
  'Cortez Hill · 4B',
  'Rosy Back Studio',
  'Little Italy Loft',
  'Bankers Hill Bungalow',
  'Ocean Beach Cottage',
  'North Park Craftsman',
];

const ASSIGNMENTS = [
  {
    id: 'a1', property_name: 'Cortez Hill · 4B', template_id: 't1', enabled: true,
    automation_config: { enabled: true, trigger_type: 'turnover' },
    field_overrides: { additional_fields: [], removed_field_ids: ['f2'], modified_fields: {} },
  },
  {
    id: 'a2', property_name: 'Cortez Hill · 4B', template_id: 't3', enabled: true,
    automation_config: { enabled: false, trigger_type: 'recurring' },
    field_overrides: null,
  },
  {
    id: 'a3', property_name: 'Cortez Hill · 4B', template_id: 't4', enabled: true,
    automation_config: { enabled: true, trigger_type: 'turnover' },
    field_overrides: null,
  },
  {
    id: 'a4', property_name: 'Rosy Back Studio', template_id: 't2', enabled: true,
    automation_config: { enabled: false, trigger_type: 'vacancy' },
    field_overrides: null,
  },
];

let stubInstalled = false;

// Installed during render, not in an effect: child effects run before parent
// effects, so an effect here would land after AutomationsView has already
// fired its mount fetch. Idempotent via the module-level flag.
function installFetchStub() {
  if (stubInstalled || typeof window === 'undefined') return;
  stubInstalled = true;
  const real = window.fetch;
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('/api/property-templates')) {
      return new Response(JSON.stringify({ assignments: ASSIGNMENTS }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return real(input as RequestInfo, init);
  }) as typeof window.fetch;
}

export default function AutomationsViewDemoPage() {
  installFetchStub();

  return (
    <div className="h-screen">
      <AutomationsView templates={TEMPLATES} properties={PROPERTIES} />
    </div>
  );
}
