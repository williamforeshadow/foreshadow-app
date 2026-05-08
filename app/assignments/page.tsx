'use client';

import { Suspense } from 'react';
import { useRouter } from 'next/navigation';
import DesktopSidebarShell from '@/components/DesktopSidebarShell';
import MyAssignmentsWindow from '@/components/windows/MyAssignmentsWindow';
import MobileRouteShell from '@/components/mobile/MobileRouteShell';
import { MobileMyAssignmentsView } from '@/components/mobile';
import { useUsers } from '@/lib/useUsers';
import { useAuth } from '@/lib/authContext';
import { useIsMobile } from '@/lib/useIsMobile';
import { ReservationDetailOverlay } from '@/components/reservations/ReservationDetailOverlay';
import { ContextTaskDetailOverlay } from '@/components/reservations/ContextTaskDetailOverlay';
import { taskPath } from '@/src/lib/links';

// /assignments - deep-linkable My Assignments page.
//
// Mobile keeps the dedicated mobile shell and still opens standalone task
// pages. Desktop uses the same flush sidebar chrome as Workspace and lets
// ?openTask=<id> open the existing right-side detail panel.
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
    <DesktopSidebarShell>
      <Suspense fallback={null}>
        <MyAssignmentsWindow users={users} currentUser={currentUser} />
      </Suspense>
      <ReservationDetailOverlay />
      <ContextTaskDetailOverlay />
    </DesktopSidebarShell>
  );
}
