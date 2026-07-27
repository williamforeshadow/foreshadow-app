'use client';

// Demo fixture for the automations hub. Public (/demo is auth-exempt) so the
// layout is browser-verifiable without a session. The hub fetches nothing, so
// no stub is needed here.

import AutomationsHub from '@/components/automations/AutomationsHub';

export default function AutomationsHubDemoPage() {
  return (
    <div className="h-screen">
      <AutomationsHub />
    </div>
  );
}
