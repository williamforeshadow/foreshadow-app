'use client';

import { memo } from 'react';
import MobileNav, { type MobileTab } from './MobileNav';
import MobileTopBar from './MobileTopBar';

interface MobileLayoutProps {
  children: React.ReactNode;
  activeTab: MobileTab | null;
  onTabChange: (tab: MobileTab) => void;
  onMenuTap: () => void;
  hideNav?: boolean;
}

const MobileLayout = memo(function MobileLayout({
  children,
  activeTab,
  onTabChange,
  onMenuTap,
  hideNav,
}: MobileLayoutProps) {
  return (
    <div className="h-dvh bg-neutral-50 dark:bg-background overflow-hidden flex flex-col safe-area-top">
      <MobileTopBar onMenuTap={onMenuTap} hidden={hideNav} />

      <main className="flex-1 min-h-0 overflow-auto hide-scrollbar pb-20">
        {children}
      </main>

      <MobileNav activeTab={activeTab} onTabChange={onTabChange} hidden={hideNav} />
    </div>
  );
});

export default MobileLayout;

export { default as MobileNav, type MobileTab } from './MobileNav';
