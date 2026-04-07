'use client';

import { memo, useState, useCallback, useEffect, useRef } from 'react';
import { useTheme } from 'next-themes';
import { useAuth } from '@/lib/authContext';
import { UserAvatar } from '@/components/ui/user-avatar';

export type MobileTab = 'assignments' | 'projects' | 'timeline' | 'messages';

interface MobileNavProps {
  activeTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
}

const tabs: { id: MobileTab; label: string; icon: React.ReactNode }[] = [
  {
    id: 'assignments',
    label: 'My Assignments',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
  },
  {
    id: 'projects',
    label: 'Bins',
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

const DRAWER_WIDTH = 220;

const MobileNav = memo(function MobileNav({ activeTab, onTabChange }: MobileNavProps) {
  const { theme, setTheme } = useTheme();
  const { user, allUsers, role, switchUser } = useAuth();
  const [open, setOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  const handleTabClick = useCallback(
    (id: MobileTab) => {
      onTabChange(id);
      setOpen(false);
    },
    [onTabChange],
  );

  useEffect(() => {
    if (!open) return;
    function onTap(e: MouseEvent | TouchEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onTap);
    document.addEventListener('touchstart', onTap);
    return () => {
      document.removeEventListener('mousedown', onTap);
      document.removeEventListener('touchstart', onTap);
    };
  }, [open]);

  return (
    <>
      {/* Hamburger trigger — fixed top-left, visible only when drawer is closed */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed top-3 left-3 z-40 flex items-center justify-center w-10 h-10 rounded-xl bg-white/80 dark:bg-neutral-900/80 backdrop-blur-md border border-neutral-200/60 dark:border-neutral-700/60 text-neutral-600 dark:text-neutral-300 active:scale-95 transition-all shadow-sm"
          style={{ marginTop: 'env(safe-area-inset-top)' }}
          aria-label="Open navigation"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      )}

      {/* Scrim */}
      <div
        className={`fixed inset-0 z-[49] bg-black/25 transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden
      />

      {/* Drawer */}
      <nav
        ref={navRef}
        className="fixed left-0 top-0 bottom-0 z-50 flex flex-col bg-white dark:bg-neutral-900 border-r border-neutral-200 dark:border-neutral-800 transition-transform duration-250 ease-out will-change-transform pl-[env(safe-area-inset-left)]"
        style={{
          width: DRAWER_WIDTH,
          transform: open ? 'translateX(0)' : `translateX(-${DRAWER_WIDTH}px)`,
        }}
      >
        {/* Header with close button */}
        <div className="shrink-0 flex items-center justify-between px-4 h-12 mt-[env(safe-area-inset-top)]">
          <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">Menu</span>
          <button
            onClick={() => setOpen(false)}
            className="flex items-center justify-center w-8 h-8 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
            aria-label="Close navigation"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tab buttons */}
        <div className="flex-1 flex flex-col gap-1 px-2 pt-1">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => handleTabClick(tab.id)}
                className={`flex items-center gap-3 rounded-xl px-3 py-3 transition-colors ${
                  isActive
                    ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400'
                    : 'text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                }`}
              >
                <div className="shrink-0">{tab.icon}</div>
                <span className={`text-sm ${isActive ? 'font-semibold' : 'font-medium'}`}>
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* User section */}
        {user && (
          <div className="shrink-0 px-2 border-t border-neutral-200 dark:border-neutral-700 pt-3 pb-2">
            <div className="flex items-center gap-3 px-3 py-2">
              <UserAvatar src={user.avatar} name={user.name} size="md" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-neutral-900 dark:text-white truncate">{user.name}</p>
                <p className="text-xs text-neutral-500 capitalize">{role}</p>
              </div>
            </div>

            {allUsers.length > 1 && (
              <div className="mt-2">
                <p className="text-xs font-medium text-neutral-400 dark:text-neutral-500 px-3 mb-1">Switch User</p>
                <div className="flex flex-col gap-0.5 max-h-40 overflow-y-auto">
                  {allUsers.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => switchUser(u.id)}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-left text-sm transition-colors ${
                        u.id === user.id
                          ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400'
                          : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                      }`}
                    >
                      <UserAvatar src={u.avatar} name={u.name} size="sm" />
                      <div className="flex-1 min-w-0">
                        <p className="truncate font-medium">{u.name}</p>
                        <p className="text-xs text-neutral-500 capitalize">{u.role}</p>
                      </div>
                      {u.id === user.id && (
                        <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Theme toggle at bottom */}
        <div className="shrink-0 px-2 pb-3 safe-area-bottom">
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="flex items-center gap-3 w-full rounded-xl px-3 py-3 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
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
            <span className="text-sm font-medium">
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </span>
          </button>
        </div>
      </nav>
    </>
  );
});

export default MobileNav;
