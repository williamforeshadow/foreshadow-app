'use client';

import Sidebar from '@/components/Sidebar';
import MyAssignmentsWindow from '@/components/windows/MyAssignmentsWindow';
import { useUsers } from '@/lib/useUsers';
import { useAuth } from '@/lib/authContext';
import { ReservationDetailOverlay } from '@/components/reservations/ReservationDetailOverlay';
import { ContextTaskDetailOverlay } from '@/components/reservations/ContextTaskDetailOverlay';

export default function AssignmentsPage() {
  const { users } = useUsers();
  const { user: currentUser } = useAuth();

  return (
    <div className="flex h-screen bg-white dark:bg-neutral-900">
      <Sidebar />
      {/* `relative` anchors any right-side detail overlays (the reservation
          overlay below + the assignments task detail) to this content area. */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        <MyAssignmentsWindow users={users} currentUser={currentUser} />
        <ReservationDetailOverlay />
        <ContextTaskDetailOverlay />
      </div>
    </div>
  );
}
