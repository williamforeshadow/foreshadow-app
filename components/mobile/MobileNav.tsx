'use client';

import { memo, useState, useCallback, useEffect, useRef } from 'react';
import { useTheme } from 'next-themes';

export type MobileTab = 'assignments' | 'projects' | 'timeline' | 'messages';

interface MobileNavProps {
  activeTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
}

const tabs: { id: MobileTab; label: string; icon: React.ReactNode }[] = [
  {
    id: 'assignments',
    label: 'My Work',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
  },
  {
    id: 'projects',
    label: 'Projects',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
      </svg>
    ),
  },
  {
    id: 'timeline',
    label: 'Timeline',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    id: 'messages',
    label: 'Messages',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    ),
  },
];

const RAIL_WIDTH = 52;
const EXPANDED_WIDTH = 176;

const MobileNav = memo(function MobileNav({ activeTab, onTabChange }: MobileNavProps) {
  const { theme, setTheme } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  const handleTabClick = useCallback(
    (id: MobileTab) => {
      onTabChange(id);
      setExpanded(false);
    },
    [onTabChange],
  );

  useEffect(() => {
    if (!expanded) return;
    function onTap(e: MouseEvent | TouchEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    }
    document.addEventListener('mousedown', onTap);
    document.addEventListener('touchstart', onTap);
    return () => {
      document.removeEventListener('mousedown', onTap);
      document.removeEventListener('touchstart', onTap);
    };
  }, [expanded]);

  return (
    <>
      {/* Scrim when expanded */}
      {expanded && (
        <div
          className="fixed inset-0 z-[49] bg-black/20 transition-opacity"
          aria-hidden
        />
      )}

      <nav
        ref={navRef}
        className="fixed left-0 top-0 bottom-0 z-50 flex flex-col bg-white dark:bg-neutral-900 border-r border-neutral-200 dark:border-neutral-800 transition-[width] duration-200 ease-in-out safe-area-left"
        style={{ width: expanded ? EXPANDED_WIDTH : RAIL_WIDTH }}
      >
        {/* Expand / collapse toggle */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 flex items-center justify-center h-12 mt-[env(safe-area-inset-top)] text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
          aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          <svg
            className={`w-5 h-5 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* Tab buttons */}
        <div className="flex-1 flex flex-col gap-1 px-1.5 pt-1">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => handleTabClick(tab.id)}
                className={`flex items-center gap-3 rounded-lg px-2.5 py-2.5 transition-colors overflow-hidden whitespace-nowrap ${
                  isActive
                    ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400'
                    : 'text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                }`}
              >
                <div className="shrink-0">{tab.icon}</div>
                <span
                  className={`text-sm transition-opacity duration-200 ${
                    expanded ? 'opacity-100' : 'opacity-0 w-0'
                  } ${isActive ? 'font-semibold' : 'font-medium'}`}
                >
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* Theme toggle at bottom */}
        <div className="shrink-0 px-1.5 pb-3 safe-area-bottom">
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="flex items-center gap-3 w-full rounded-lg px-2.5 py-2.5 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors overflow-hidden whitespace-nowrap"
          >
            <div className="shrink-0">
              {theme === 'dark' ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </div>
            <span
              className={`text-sm font-medium transition-opacity duration-200 ${
                expanded ? 'opacity-100' : 'opacity-0 w-0'
              }`}
            >
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </span>
          </button>
        </div>
      </nav>
    </>
  );
});

export default MobileNav;
export { RAIL_WIDTH };
