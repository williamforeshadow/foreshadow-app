'use client';

// Automations hub — the landing page for the sidebar's Automations entry.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import AutomationsHub from '@/components/automations/AutomationsHub';
import { WindowHeader } from '@/components/ui/window-header';

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
    <>
      <WindowHeader title="Automations" />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <AutomationsHub />
      </div>
    </>
  );
}
