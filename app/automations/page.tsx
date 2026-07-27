'use client';

// Automations hub — the landing page for the sidebar's Automations entry.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import DesktopSidebarShell from '@/components/DesktopSidebarShell';
import AutomationsHub from '@/components/automations/AutomationsHub';

export default function AutomationsPage() {
  const router = useRouter();

  // Legacy deep link from when this route was the task list behind a tab bar.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') === 'slack') {
      router.replace('/automations/new-engine');
    }
  }, [router]);

  return (
    <DesktopSidebarShell>
      <div className="flex flex-1 flex-col overflow-hidden">
        <AutomationsHub />
      </div>
    </DesktopSidebarShell>
  );
}
