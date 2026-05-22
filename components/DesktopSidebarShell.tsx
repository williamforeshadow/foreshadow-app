'use client';

import type { ReactNode } from 'react';
import Sidebar from '@/components/Sidebar';

export default function DesktopSidebarShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-card">
      <Sidebar />
      <div className="relative flex flex-1 min-w-0 flex-col overflow-hidden">
        {children}
      </div>
    </div>
  );
}
