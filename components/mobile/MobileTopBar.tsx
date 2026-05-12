'use client';

import { memo } from 'react';
import { NotificationBell } from '@/components/notifications/NotificationBell';

interface MobileTopBarProps {
  onMenuTap: () => void;
  hidden?: boolean;
}

const MobileTopBar = memo(function MobileTopBar({ onMenuTap, hidden }: MobileTopBarProps) {
  return (
    <div
      className={`flex-shrink-0 h-11 px-2 flex items-center justify-between transition-transform duration-300 ${
        hidden ? '-translate-y-full' : 'translate-y-0'
      }`}
    >
      <button
        onClick={onMenuTap}
        className="w-10 h-10 flex items-center justify-center rounded-lg text-neutral-700 dark:text-[#a09e9a] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] transition-colors"
        aria-label="Open menu"
      >
        <svg className="w-[22px] h-[22px]" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      <NotificationBell compact />
    </div>
  );
});

export default MobileTopBar;
