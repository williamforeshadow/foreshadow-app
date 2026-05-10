'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import { SidebarToggleButton } from '@/components/SidebarToggleButton';
import { useUsers } from '@/lib/useUsers';
import { useAuth } from '@/lib/authContext';
import {
  DASHBOARD_VIEW_STORAGE_KEY,
  type DashboardView,
  isDashboardView,
} from '@/lib/dashboardViews';
import { useSidebar } from '@/lib/sidebarContext';
import TimelineWindow from '@/components/windows/TimelineWindow';
import TurnoversWindow from '@/components/windows/TurnoversWindow';
import ProjectsWindow from '@/components/windows/ProjectsWindow';
import TasksWindow from '@/components/windows/TasksWindow';
import { AiChat } from '@/components/AiChat';
import { ReservationDetailOverlay } from '@/components/reservations/ReservationDetailOverlay';
import { ContextTaskDetailOverlay } from '@/components/reservations/ContextTaskDetailOverlay';

export default function DesktopApp() {
  const { users } = useUsers();
  const { user: currentUser } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isOpen: isSidebarOpen } = useSidebar();

  // Active view derives from the URL (`?view=...`). Falls back to localStorage
  // (last-used view) and finally to 'turnovers'. Lives in the URL so refresh
  // and shared links land on the right tab.
  const urlView = searchParams?.get('view');
  const [activeView, setActiveView] = useState<DashboardView>(() => {
    if (typeof window !== 'undefined') {
      const fromUrl = new URLSearchParams(window.location.search).get('view');
      if (isDashboardView(fromUrl)) return fromUrl;
      if (fromUrl) return 'turnovers';
      try {
        const stored = window.localStorage.getItem(DASHBOARD_VIEW_STORAGE_KEY);
        if (isDashboardView(stored)) return stored;
      } catch {
        // ignore
      }
    }
    return 'turnovers';
  });

  useEffect(() => {
    if (isDashboardView(urlView) && urlView !== activeView) {
      setActiveView(urlView);
    } else if (urlView && !isDashboardView(urlView)) {
      setActiveView('turnovers');
      router.replace('/?view=turnovers', { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlView]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(DASHBOARD_VIEW_STORAGE_KEY, activeView);
    } catch {
      // ignore
    }
  }, [activeView]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const live = new URLSearchParams(window.location.search).get('view');
    if (live == null || !isDashboardView(live)) {
      const params = new URLSearchParams(window.location.search);
      params.set('view', live == null ? activeView : 'turnovers');
      router.replace(`/?${params.toString()}`, { scroll: false });
    }
    // Run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleViewChange = useCallback(
    (next: DashboardView) => {
      setActiveView(next);
      const params = new URLSearchParams();
      params.set('view', next);
      router.replace(`/?${params.toString()}`, { scroll: false });
    },
    [router]
  );

  const isTimelineView = activeView === 'timeline';

  return (
    <div className="flex h-screen bg-neutral-50 dark:bg-background overflow-hidden">
      <Sidebar
        surface={isTimelineView ? 'timeline' : 'default'}
        activeWorkspaceView={activeView}
        onWorkspaceViewChange={handleViewChange}
      />

      <div className="flex-1 relative overflow-hidden bg-background">
        {!isSidebarOpen && (
          <SidebarToggleButton className="absolute left-3 top-3 z-50 bg-white/95 shadow-sm ring-1 ring-neutral-200 dark:bg-[#111114] dark:ring-[var(--timeline-border-subtle)]" />
        )}

        <div className={`absolute inset-0 ${activeView === 'turnovers' ? '' : 'hidden'}`}>
          <TurnoversWindow users={users} currentUser={currentUser} />
        </div>

        <div className={`absolute inset-0 ${activeView === 'timeline' ? '' : 'hidden'}`}>
          <TimelineWindow users={users} currentUser={currentUser} />
        </div>

        <div className={`absolute inset-0 ${activeView === 'projects' ? '' : 'hidden'}`}>
          <ProjectsWindow users={users} currentUser={currentUser} />
        </div>

        <div className={`absolute inset-0 ${activeView === 'tasks' ? '' : 'hidden'}`}>
          <TasksWindow
            currentUser={currentUser}
            users={users}
            isActive={activeView === 'tasks'}
          />
        </div>

        <AiChat />
        <ReservationDetailOverlay />
        <ContextTaskDetailOverlay />
      </div>
    </div>
  );
}
