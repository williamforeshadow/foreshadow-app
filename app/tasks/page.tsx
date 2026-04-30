'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useIsMobile } from '@/lib/useIsMobile';
import MobileRouteShell from '@/components/mobile/MobileRouteShell';
import MobileTasksView from '@/components/mobile/MobileTasksView';

// Standalone Tasks route. Reachable from the mobile drawer ("Tasks" entry)
// and as a deep-linkable URL (so shared filtered views work in both clients).
//
// On mobile: renders the mobile-tailored MobileTasksView inside the standard
// MobileRouteShell (drawer-accessible, full-bleed under the system bars).
//
// On desktop: redirects to `/?view=tasks` while preserving the current query
// params (status, sort, etc). Keeps a single canonical desktop entry point —
// the dashboard — and avoids two parallel desktop renderings of the same view.
function TasksPageInner() {
  const isMobile = useIsMobile();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (isMobile === false) {
      const qs = searchParams?.toString() || '';
      const target = qs ? `/?view=tasks&${qs}` : `/?view=tasks`;
      router.replace(target as any);
    }
  }, [isMobile, router, searchParams]);

  if (isMobile === null) return null;
  if (!isMobile) return null;

  return (
    <MobileRouteShell>
      <MobileTasksView />
    </MobileRouteShell>
  );
}

export default function TasksPage() {
  // useSearchParams requires a Suspense boundary in Next 14+ for the static
  // rendering case.
  return (
    <Suspense fallback={null}>
      <TasksPageInner />
    </Suspense>
  );
}
