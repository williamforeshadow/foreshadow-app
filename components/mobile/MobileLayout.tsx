'use client';

import { memo } from 'react';

interface MobileLayoutProps {
  children: React.ReactNode;
}

const MobileLayout = memo(function MobileLayout({ children }: MobileLayoutProps) {
  return (
    <div className="h-dvh bg-neutral-50 dark:bg-background overflow-hidden flex flex-col safe-area-top safe-area-bottom">
      <main className="flex-1 min-h-0 overflow-auto hide-scrollbar">
        {children}
      </main>
    </div>
  );
});

export default MobileLayout;
