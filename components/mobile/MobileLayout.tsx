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
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      {/* Main Content Area - scrollable, with padding for bottom nav only */}
      <main className="pb-20 min-h-screen">
        {children}
      </main>

      {/* Fixed Bottom Navigation */}
      <MobileNav activeTab={activeTab} onTabChange={onTabChange} />
    </div>
  );
});

export default MobileLayout;

// Export everything from this directory for easy importing
export { default as MobileNav, type MobileTab } from './MobileNav';

