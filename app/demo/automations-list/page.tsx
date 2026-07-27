'use client';

// Demo fixtures for the Slack Automations list. Public (/demo is auth-exempt)
// so the layout is browser-verifiable without a session.
//
// AutomationList fetches /api/automations and /api/properties itself, both of
// which 401 without a session — so this page installs a scoped fetch stub for
// those two endpoints before mounting. Demo-only.

import AutomationsBackLink from '@/components/automations/AutomationsBackLink';
import AutomationList from '@/components/automations/v2/AutomationList';
import type { Automation } from '@/lib/automations/types';

const PROPERTIES = [
  { id: 'p1', name: 'Cortez Hill · 4B' },
  { id: 'p2', name: 'Rosy Back Studio' },
  { id: 'p3', name: 'Little Italy Loft' },
  { id: 'p4', name: 'Bankers Hill Bungalow' },
];

const AUTOMATIONS: Automation[] = [
  {
    id: 'a1',
    name: 'Same-day flip alert',
    enabled: true,
    trigger: {
      kind: 'schedule',
      schedule: { frequency: 'day', time: '07:00', weekdays: [], month_days: [], interval: 1, timezone: 'property' },
      for_each: { entity: 'reservation' },
    },
    conditions: { kind: 'group', match: 'all', children: [] },
    actions: [
      { id: 'ac1', kind: 'slack_message', recipients: [], message_template: 'Flip today at {{this.property.name}}' },
    ],
    property_ids: [],
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
  },
  {
    id: 'a2',
    name: 'Maintenance task escalation',
    enabled: true,
    trigger: { kind: 'row_change', entity: 'task', on: ['created', 'updated'] },
    conditions: { kind: 'group', match: 'all', children: [] },
    actions: [
      { id: 'ac2', kind: 'slack_message', recipients: [], message_template: 'Escalating {{this.title}}' },
      { id: 'ac3', kind: 'slack_message', recipients: [], message_template: 'FYI {{this.title}}' },
    ],
    property_ids: ['p1', 'p3', 'p4'],
    created_at: '2026-07-02T00:00:00Z',
    updated_at: '2026-07-02T00:00:00Z',
  },
  {
    id: 'a3',
    name: 'Weekly occupancy digest',
    enabled: false,
    trigger: {
      kind: 'schedule',
      schedule: { frequency: 'week', time: '09:00', weekdays: [1], month_days: [], interval: 1, timezone: 'company' },
    },
    conditions: { kind: 'group', match: 'all', children: [] },
    actions: [
      { id: 'ac4', kind: 'slack_message', recipients: [], message_template: 'This week…' },
    ],
    property_ids: [],
    created_at: '2026-07-03T00:00:00Z',
    updated_at: '2026-07-03T00:00:00Z',
  },
  {
    id: 'a4',
    name: 'New guest review posted',
    enabled: true,
    trigger: { kind: 'row_change', entity: 'reservation', on: ['updated'] },
    conditions: { kind: 'group', match: 'all', children: [] },
    actions: [],
    property_ids: ['p2'],
    created_at: '2026-07-04T00:00:00Z',
    updated_at: '2026-07-04T00:00:00Z',
  },
];

let stubInstalled = false;

// Installed during render, not in an effect: child effects run before parent
// effects, so an effect here would land after AutomationList has already fired
// its mount fetch. Idempotent via the module-level flag.
function installFetchStub() {
  if (stubInstalled || typeof window === 'undefined') return;
  stubInstalled = true;
  const real = window.fetch;
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('/api/automations')) {
      // PUT / DELETE from the row controls succeed silently.
      const body = init?.method && init.method !== 'GET' ? {} : { automations: AUTOMATIONS };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.startsWith('/api/properties')) {
      return new Response(JSON.stringify({ properties: PROPERTIES }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return real(input as RequestInfo, init);
  }) as typeof window.fetch;
}

export default function AutomationsListDemoPage() {
  installFetchStub();

  return (
    <div className="panel-form flex h-screen flex-col" style={{ background: 'var(--task-surface-0)' }}>
      <AutomationsBackLink />
      <div className="flex-1 overflow-hidden">
        <AutomationList />
      </div>
    </div>
  );
}
