'use client';

import Sidebar from '@/components/Sidebar';
import MyAssignmentsWindow from '@/components/windows/MyAssignmentsWindow';
import { useUsers } from '@/lib/useUsers';
import { useAuth } from '@/lib/authContext';

export default function AssignmentsPage() {
  const { users } = useUsers();
  const { user: currentUser } = useAuth();

  return (
    <div className="flex h-screen bg-white dark:bg-neutral-900">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <MyAssignmentsWindow users={users} currentUser={currentUser} />
      </div>
    </div>
  );
}
