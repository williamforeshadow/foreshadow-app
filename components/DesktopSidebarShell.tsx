'use client';

import type { ReactNode } from 'react';
import Sidebar from '@/components/Sidebar';
import { SidebarToggleButton } from '@/components/SidebarToggleButton';
import { useSidebar } from '@/lib/sidebarContext';

export default function DesktopSidebarShell({ children }: { children: ReactNode }) {
  const { isOpen: isSidebarOpen } = useSidebar();

  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-card">
      <Sidebar />
      <div className="relative flex flex-1 min-w-0 flex-col overflow-hidden">
        {!isSidebarOpen && (
          <SidebarToggleButton className="absolute left-3 top-3 z-50 bg-white/95 shadow-sm ring-1 ring-neutral-200 dark:bg-[var(--timeline-surface-1)] dark:ring-[var(--timeline-border-subtle)]" />
        )}
        {children}
      </div>
    </div>
  );
}
