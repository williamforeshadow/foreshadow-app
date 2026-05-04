'use client';

import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import { SidebarToggleButton } from '@/components/SidebarToggleButton';
import MyAssignmentsWindow from '@/components/windows/MyAssignmentsWindow';
import MobileRouteShell from '@/components/mobile/MobileRouteShell';
import { MobileMyAssignmentsView } from '@/components/mobile';
import { useUsers } from '@/lib/useUsers';
import { useAuth } from '@/lib/authContext';
import { useIsMobile } from '@/lib/useIsMobile';
import { ReservationDetailOverlay } from '@/components/reservations/ReservationDetailOverlay';
import { ContextTaskDetailOverlay } from '@/components/reservations/ContextTaskDetailOverlay';
import { taskPath } from '@/src/lib/links';

// /assignments — deep-linkable My Assignments page.
//
// Mirrors the mobile/desktop split that app/properties/layout.tsx and
// app/tasks/[id]/layout.tsx already use, so a Slack mobile-webview tap
// lands in a real mobile shell instead of a cramped desktop sidebar.
//
// Mobile path:
//   - MobileRouteShell with `backHref="/"` (back arrow returns to the
//     main mobile app where the bottom-nav lives).
//   - Renders the existing MobileMyAssignmentsView. Tapping a row
//     navigates to /tasks/[id], which has its own mobile chrome and
//     full task detail — this avoids duplicating the inline task /
//     project detail-panel state machine that MobileApp owns.
//
// Desktop path: unchanged from the original — sidebar + topbar +
// MyAssignmentsWindow + the two right-side detail overlays.
//
// `isMobile === null` early-return matches the convention used by
// other layouts: useIsMobile is unresolved before first paint, so we
// render nothing for one frame to avoid flashing the wrong chrome.
export default function AssignmentsPage() {
  const router = useRouter();
  const { users } = useUsers();
  const { user: currentUser } = useAuth();
  const isMobile = useIsMobile();

  if (isMobile === null) return null;

  if (isMobile) {
    return (
      <MobileRouteShell backHref="/">
        <MobileMyAssignmentsView
          onTaskClick={(task) => {
            const id = task?.task_id ?? task?.id;
            if (id) router.push(taskPath(id));
          }}
          onProjectClick={(project) => {
            const id = project?.id ?? project?.task_id;
            if (id) router.push(taskPath(id));
          }}
        />
      </MobileRouteShell>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-neutral-900">
      {/* Thin top bar with sidebar toggle — keeps the toggle in the same
          screen position as every other page. */}
      <div className="flex-shrink-0 px-3 py-2 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800">
        <SidebarToggleButton />
      </div>

      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        {/* `relative` anchors any right-side detail overlays (the reservation
            overlay below + the assignments task detail) to this content area. */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          <MyAssignmentsWindow users={users} currentUser={currentUser} />
          <ReservationDetailOverlay />
          <ContextTaskDetailOverlay />
        </div>
      </div>
    </div>
  );
}
