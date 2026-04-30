'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import { SidebarToggleButton } from '@/components/SidebarToggleButton';
import { Button } from '@/components/ui/button';
import { useUsers } from '@/lib/useUsers';
import { useAuth } from '@/lib/authContext';
import TimelineWindow from '@/components/windows/TimelineWindow';
import TurnoversWindow from '@/components/windows/TurnoversWindow';
import ProjectsWindow from '@/components/windows/ProjectsWindow';
import TasksWindow from '@/components/windows/TasksWindow';
import MessagesWindow from '@/components/windows/MessagesWindow';
import { AiChat } from '@/components/AiChat';
import { ReservationDetailOverlay } from '@/components/reservations/ReservationDetailOverlay';
import { ContextTaskDetailOverlay } from '@/components/reservations/ContextTaskDetailOverlay';

type ViewType = 'turnovers' | 'timeline' | 'projects' | 'tasks' | 'messages';

const VIEW_LABELS: Record<ViewType, string> = {
  turnovers: 'Turnovers',
  timeline: 'Timeline',
  projects: 'Bins',
  tasks: 'Tasks',
  messages: 'Messages',
};

const VIEWS: ViewType[] = ['turnovers', 'timeline', 'projects', 'tasks', 'messages'];

const VIEW_STORAGE_KEY = 'dashboard:lastView';

function isViewType(v: string | null | undefined): v is ViewType {
  return v === 'turnovers' || v === 'timeline' || v === 'projects' || v === 'tasks' || v === 'messages';
}

export default function DesktopApp() {
  const { users } = useUsers();
  const { user: currentUser } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Active view derives from the URL (`?view=...`). Falls back to localStorage
  // (last-used view) and finally to 'turnovers'. Lives in the URL so refresh
  // and shared links land on the right tab — and so per-tab filter state
  // (read by the individual view components) is unambiguous.
  const urlView = searchParams?.get('view');
  const [activeView, setActiveView] = useState<ViewType>(() => {
    if (isViewType(urlView)) return urlView;
    if (typeof window !== 'undefined') {
      try {
        const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
        if (isViewType(stored)) return stored;
      } catch {
        // ignore
      }
    }
    return 'turnovers';
  });

  // If the URL changes externally (back/forward, deep link), follow it.
  useEffect(() => {
    if (isViewType(urlView) && urlView !== activeView) {
      setActiveView(urlView);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlView]);

  // Stash the active view so a fresh visit to `/` restores the user's last
  // used tab. Doesn't replace URL persistence — it's the visit-with-no-params
  // fallback.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, activeView);
    } catch {
      // ignore
    }
  }, [activeView]);

  // On first mount, if no `view` param is present in the URL but we restored
  // from localStorage (or fell back to turnovers), reflect that into the URL
  // so the rest of the app — including the views' own filter state — has a
  // consistent source of truth.
  useEffect(() => {
    if (urlView == null) {
      const params = new URLSearchParams(searchParams?.toString() || '');
      params.set('view', activeView);
      router.replace(`/?${params.toString()}` as any, { scroll: false });
    }
    // Run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the user clicks a tab, switch view + clear all per-tab query params
  // (search/filter/sort namespaces are tab-specific and should not bleed
  // across tab switches). Keep `view` only.
  const handleViewChange = useCallback(
    (next: ViewType) => {
      setActiveView(next);
      const params = new URLSearchParams();
      params.set('view', next);
      router.replace(`/?${params.toString()}` as any, { scroll: false });
    },
    [router]
  );

  return (
    <div className="flex flex-col h-screen bg-neutral-50 dark:bg-neutral-950 overflow-hidden">
      {/* Top header: spans the full viewport width above the sidebar so the
          sidebar toggle stays inline with the view tabs and lives in the
          same screen position whether the sidebar is open or hidden. */}
      <div className="flex-shrink-0 px-4 py-3 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800">
        <div className="flex items-center justify-between gap-3">
          {/* Left cluster: sidebar toggle + active page title */}
          <div className="flex items-center gap-2 min-w-0">
            <SidebarToggleButton />
            <h1 className="text-xl font-semibold text-neutral-900 dark:text-white truncate">
              {VIEW_LABELS[activeView]}
            </h1>
          </div>

          {/* View Navigation */}
          <div className="flex items-center gap-1">
            {VIEWS.map((view) => (
              <Button
                key={view}
                onClick={() => handleViewChange(view)}
                variant={activeView === view ? 'default' : 'ghost'}
                size="sm"
                className={`px-4 py-2 ${
                  activeView === view
                    ? ''
                    : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
                }`}
              >
                {VIEW_LABELS[view]}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Body: sidebar + active view content */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />

        {/* Full Screen Content Area */}
        <div className="flex-1 relative overflow-hidden bg-background">
          {/* Render active view - all views stay mounted for state preservation.
              Each view receives `isActive` so it knows whether to write its
              own filter state to the URL — only the visible view should. */}
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

          <div className={`absolute inset-0 ${activeView === 'messages' ? '' : 'hidden'}`}>
            <MessagesWindow currentUser={currentUser} users={users} />
          </div>

          {/* AI Chat */}
          <AiChat />

          {/* Reservation + context task overlays
              ------------------------------------
              Both anchor to the `flex-1 relative` content area above so they
              line up with per-tab task overlays (same `absolute right-0 w-1/3`
              slot). Strict mutual exclusion is enforced by
              ReservationViewerProvider — only one of the two ever renders. */}
          <ReservationDetailOverlay />
          <ContextTaskDetailOverlay />
        </div>
      </div>
    </div>
  );
}
