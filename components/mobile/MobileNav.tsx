'use client';

import { memo, useCallback } from 'react';

export type MobileTab = 'assignments' | 'projects' | 'timeline';

interface MobileNavProps {
  activeTab: MobileTab | null;
  onTabChange: (tab: MobileTab) => void;
  hidden?: boolean;
}

const tabs: { id: MobileTab; label: string; icon: (active: boolean) => React.ReactNode }[] = [
  {
    id: 'assignments',
    label: 'Mine',
    icon: (active) => (
      <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 11l3 3L22 4" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
  },
  {
    id: 'projects',
    label: 'Bins',
    icon: (active) => (
      <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} viewBox="0 0 24 24">
        <rect x="3" y="3" width="7" height="18" rx="1" />
        <rect x="14" y="3" width="7" height="11" rx="1" />
      </svg>
    ),
  },
  {
    id: 'timeline',
    label: 'Timeline',
    icon: (active) => (
      <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
];

const MobileNav = memo(function MobileNav({ activeTab, onTabChange, hidden }: MobileNavProps) {
  const handleTabClick = useCallback(
    (id: MobileTab) => { onTabChange(id); },
    [onTabChange],
  );

  return (
    <nav className={`fixed left-0 right-0 bottom-0 z-50 border-t border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)] bg-white/90 dark:bg-background/90 backdrop-blur-xl safe-area-bottom transition-transform duration-300 ${hidden ? 'translate-y-full' : 'translate-y-0'}`}>
      <div className="flex items-start justify-around px-4 pt-2 pb-1">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => handleTabClick(tab.id)}
              className={`flex flex-col items-center gap-1 py-1 px-3 transition-colors ${
                isActive
                  ? 'text-neutral-900 dark:text-[#f0efed]'
                  : 'text-neutral-400 dark:text-[#66645f]'
              }`}
            >
              {tab.icon(isActive)}
              <span className="text-[9.5px] uppercase tracking-[0.08em] font-medium leading-none">
                {tab.label}
              </span>
              {isActive && (
                <div className="w-[3px] h-[3px] rounded-full bg-neutral-900 dark:bg-[#f0efed] -mt-0.5" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
});

export default MobileNav;
