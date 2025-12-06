'use client';

import { memo, useState } from 'react';
import MobileNav, { type MobileTab } from './MobileNav';
import MobileHeader from './MobileHeader';

interface MobileLayoutProps {
  children: React.ReactNode;
  activeTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
  headerTitle?: string;
  headerRightAction?: React.ReactNode;
}

const MobileLayout = memo(function MobileLayout({
  children,
  activeTab,
  onTabChange,
  headerTitle,
  headerRightAction,
}: MobileLayoutProps) {
  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      {/* Fixed Header */}
      <MobileHeader 
        activeTab={activeTab} 
        title={headerTitle}
        rightAction={headerRightAction}
      />

      {/* Main Content Area - scrollable, with padding for header and nav */}
      <main className="pt-14 pb-20 min-h-screen">
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
export { default as MobileHeader } from './MobileHeader';

