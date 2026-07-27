'use client';

// Demo fixtures for the Slack automation editor. Public (/demo is auth-exempt)
// so the layout is browser-verifiable without a session.
//
// Rendered with no automationId, so the editor starts from its own defaults and
// never hits the load path. It still fetches /api/properties and
// /api/slack/channels on mount, both of which 401 without a session — those two
// are stubbed here so the pickers have content. Demo-only.

import AutomationEditor from '@/components/automations/v2/AutomationEditor';

const PROPERTIES = [
  { id: 'p1', name: 'Cortez Hill · 4B' },
  { id: 'p2', name: 'Rosy Back Studio' },
  { id: 'p3', name: 'Little Italy Loft' },
  { id: 'p4', name: 'Bankers Hill Bungalow' },
];

const CHANNELS = [
  { id: 'c1', name: 'housekeeping', is_private: false, is_member: true },
  { id: 'c2', name: 'maintenance', is_private: false, is_member: true },
  { id: 'c3', name: 'ops-alerts', is_private: true, is_member: true },
];

let stubInstalled = false;

// Installed during render, not in an effect: child effects run before parent
// effects, so an effect here would land after AutomationEditor has already
// fired its mount fetch. Idempotent via the module-level flag.
function installFetchStub() {
  if (stubInstalled || typeof window === 'undefined') return;
  stubInstalled = true;
  const real = window.fetch;
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('/api/properties')) {
      return new Response(JSON.stringify({ properties: PROPERTIES }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.startsWith('/api/slack/channels')) {
      return new Response(JSON.stringify({ channels: CHANNELS }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return real(input as RequestInfo, init);
  }) as typeof window.fetch;
}

export default function AutomationEditorDemoPage() {
  installFetchStub();

  return (
    <div className="h-screen">
      <AutomationEditor />
    </div>
  );
}
