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
    <div className="h-dvh bg-neutral-50 dark:bg-neutral-950 overflow-hidden">
      <MobileNav activeTab={activeTab} onTabChange={onTabChange} />

      <main className="h-full overflow-auto hide-scrollbar">
        {children}
      </main>
    </div>
  );
});

export default MobileLayout;

export { default as MobileNav, type MobileTab } from './MobileNav';
