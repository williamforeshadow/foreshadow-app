'use client';

import { memo } from 'react';
import MobileNav, { type MobileTab, RAIL_WIDTH } from './MobileNav';

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
      {/* Sidebar Navigation */}
      <MobileNav activeTab={activeTab} onTabChange={onTabChange} />

      {/* Main Content Area — offset by the sidebar rail width, full viewport height */}
      <main
        className="h-full overflow-auto hide-scrollbar"
        style={{ marginLeft: RAIL_WIDTH }}
      >
        {children}
      </main>
    </div>
  );
});

export default MobileLayout;

// Export everything from this directory for easy importing
export { default as MobileNav, type MobileTab } from './MobileNav';
