'use client';

import { memo } from 'react';
import { ModeToggle } from '@/components/mode-toggle';
import type { MobileTab } from './MobileNav';

interface MobileHeaderProps {
  activeTab: MobileTab;
  title?: string;
  rightAction?: React.ReactNode;
}

const tabTitles: Record<MobileTab, string> = {
  cards: 'Cleaning & Maintenance',
  timeline: 'Timeline',
  query: 'Query Builder',
  projects: 'Projects',
};

const MobileHeader = memo(function MobileHeader({ 
  activeTab, 
  title,
  rightAction 
}: MobileHeaderProps) {
  return (
    <header className="fixed top-0 left-0 right-0 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 z-40 safe-area-top">
      <div className="flex items-center justify-between h-14 px-4">
        {/* Left: Logo/Title */}
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">F</span>
          <h1 className="text-base font-semibold text-neutral-900 dark:text-white truncate">
            {title || tabTitles[activeTab]}
          </h1>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          {rightAction}
          <ModeToggle />
        </div>
      </div>
    </header>
  );
});

export default MobileHeader;

