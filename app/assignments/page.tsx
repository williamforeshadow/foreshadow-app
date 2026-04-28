'use client';

import Sidebar from '@/components/Sidebar';
import { SidebarToggleButton } from '@/components/SidebarToggleButton';
import MyAssignmentsWindow from '@/components/windows/MyAssignmentsWindow';
import { useUsers } from '@/lib/useUsers';
import { useAuth } from '@/lib/authContext';
import { ReservationDetailOverlay } from '@/components/reservations/ReservationDetailOverlay';
import { ContextTaskDetailOverlay } from '@/components/reservations/ContextTaskDetailOverlay';

export default function AssignmentsPage() {
  const { users } = useUsers();
  const { user: currentUser } = useAuth();

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
