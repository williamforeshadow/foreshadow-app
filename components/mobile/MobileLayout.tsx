'use client';

import { memo } from 'react';
import MobileNav, { type MobileTab } from './MobileNav';

interface MobileLayoutProps {
  children: React.ReactNode;
  activeTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
}

const MobileLayout = memo(function MobileLayout({
  children,
  activeTab,
  onTabChange,
}: MobileLayoutProps) {
  return (
    <div className="h-dvh bg-neutral-50 dark:bg-[#0b0b0c] overflow-hidden flex flex-col safe-area-top">
      <main className="flex-1 min-h-0 overflow-auto hide-scrollbar pb-20">
        {children}
      </main>

      <MobileNav activeTab={activeTab} onTabChange={onTabChange} />
    </div>
  );
});

export default MobileLayout;

export { default as MobileNav, type MobileTab } from './MobileNav';
