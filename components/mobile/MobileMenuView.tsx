'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { GraduationCap, FlaskConical, Settings } from 'lucide-react';
import { useAuth } from '@/lib/authContext';
import { UserAvatar } from '@/components/ui/user-avatar';
import { NotificationBell } from '@/components/notifications/NotificationBell';

// The "Menu" tab-root screen. A hub that gathers the nav items that don't earn
// their own bottom tab: the account (avatar → Edit Profile / Theme / Sign Out),
// notifications (top-right bell), and the remaining destinations (Tasks, and
// Properties for admins). The bottom tab bar (from AppChrome) stays visible
// here; tapping a destination drills in with its own back arrow.

const roleColors: Record<string, string> = {
  superadmin: 'bg-purple-500',
  manager: 'bg-blue-500',
  staff: 'bg-emerald-500',
  vendor: 'bg-amber-500',
};

const rowCard =
  'w-full flex items-center gap-4 p-4 rounded-xl text-left transition-all active:scale-[0.98] ' +
  'bg-neutral-100/80 dark:bg-[rgba(255,255,255,0.025)] ' +
  'border border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)]';

export function MobileMenuView() {
  const router = useRouter();
  const { user, role, canEditTemplates, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!accountOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAccountOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [accountOpen]);

  const handleSignOut = async () => {
    setAccountOpen(false);
    await signOut();
    router.push('/login');
  };

  // The menu is grouped: an ungrouped top block for the broad destinations, then
  // a "Concierge" section for its config surfaces (these have no bottom tab and
  // otherwise aren't reachable on mobile). `show` gates a row; concierge is
  // ungated for now — role gating can be layered on later per row.
  const generalItems = [
    {
      label: 'Tasks',
      description: 'The full task ledger',
      href: '/tasks',
      show: true,
      icon: (
        <MenuRowIcon>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </MenuRowIcon>
      ),
    },
    {
      label: 'Properties',
      description: 'Listings, reservations, knowledge',
      href: '/properties',
      show: canEditTemplates,
      icon: (
        <MenuRowIcon>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </MenuRowIcon>
      ),
    },
  ];

  const conciergeItems = [
    {
      label: 'Concierge Training',
      description: 'Teach the concierge how to reply',
      href: '/messages/concierge-training',
      show: true,
      icon: <GraduationCap className="h-5 w-5" aria-hidden />,
    },
    {
      label: 'Concierge Testing',
      description: 'Try it on sample conversations',
      href: '/messages/concierge-testing',
      show: true,
      icon: <FlaskConical className="h-5 w-5" aria-hidden />,
    },
    {
      label: 'Concierge Settings',
      description: 'Proposals, tools, and sensitivity',
      href: '/messages/concierge-training/settings',
      show: true,
      icon: <Settings className="h-5 w-5" aria-hidden />,
    },
  ];

  const sections = [
    { heading: null as string | null, items: generalItems },
    { heading: 'Concierge', items: conciergeItems },
  ]
    .map((s) => ({ ...s, items: s.items.filter((i) => i.show) }))
    .filter((s) => s.items.length > 0);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-white dark:bg-card">
      {/* Header — title left, account + notifications right. */}
      <div
        className="flex shrink-0 items-center justify-between gap-2 px-[22px] pb-3"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)' }}
      >
        <h1 className="text-[26px] font-semibold tracking-tight text-neutral-900 dark:text-[#f0efed]">
          Menu
        </h1>
        <div className="flex items-center gap-1">
          <div ref={accountRef} className="relative">
            <button
              type="button"
              onClick={() => setAccountOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={accountOpen}
              aria-label="Account"
              className="flex items-center rounded-full transition-opacity active:opacity-70"
            >
              <UserAvatar src={user?.avatar} name={user?.name ?? 'You'} size="md" />
            </button>

            {accountOpen ? (
              <>
                <div className="fixed inset-0 z-[59]" onClick={() => setAccountOpen(false)} aria-hidden />
                <div
                  role="menu"
                  className="absolute right-0 top-full z-[60] mt-2 min-w-[220px] overflow-hidden rounded-xl border border-[var(--surface-elevated-line)] bg-white shadow-xl dark:bg-card"
                >
                  {user ? (
                    <div className="flex items-center gap-3 border-b border-neutral-200/60 px-4 py-3 dark:border-[rgba(255,255,255,0.07)]">
                      <UserAvatar src={user.avatar} name={user.name} size="md" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-medium text-neutral-900 dark:text-[#f0efed]">
                          {user.name}
                        </p>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          <span className={`h-[6px] w-[6px] rounded-full ${roleColors[role || 'staff']}`} />
                          <span className="text-[11px] capitalize tracking-[0.02em] text-neutral-500 dark:text-[#66645f]">
                            {role}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <AccountItem
                    label="Edit Profile"
                    onClick={() => {
                      setAccountOpen(false);
                      router.push('/profile');
                    }}
                    icon={
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    }
                  />

                  {/* Theme toggle */}
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span className="flex items-center gap-2.5 text-[14px] text-neutral-700 dark:text-[#a09e9a]">
                      <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                      </svg>
                      Theme
                    </span>
                    <button
                      type="button"
                      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                      aria-label="Toggle theme"
                      className={`relative inline-flex h-[22px] w-[40px] items-center rounded-full transition-colors ${
                        theme === 'dark' ? 'bg-neutral-200 dark:bg-[#f0efed]' : 'bg-neutral-300'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 rounded-full bg-white transition-transform dark:bg-background ${
                          theme === 'dark' ? 'translate-x-[20px]' : 'translate-x-[3px]'
                        }`}
                      />
                    </button>
                  </div>

                  <AccountItem label="Sign Out" onClick={handleSignOut} icon={
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6A2.25 2.25 0 005.25 5.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
                  } />
                </div>
              </>
            ) : null}
          </div>

          <NotificationBell compact />
        </div>
      </div>

      {/* Destinations */}
      <div className="pb-mobile-nav min-h-0 flex-1 overflow-y-auto hide-scrollbar px-[22px]">
        <div className="flex flex-col gap-3 pt-1">
          {sections.map((section) => (
            <div key={section.heading ?? 'general'} className="flex flex-col gap-3">
              {section.heading ? (
                <p className="px-1 pb-0.5 pt-3 text-[11px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-[#66645f]">
                  {section.heading}
                </p>
              ) : null}
              {section.items.map((d) => (
                <button
                  key={d.href}
                  type="button"
                  onClick={() => router.push(d.href)}
                  className={rowCard}
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-neutral-200/60 dark:bg-[rgba(255,255,255,0.04)]">
                    <span className="text-neutral-500 dark:text-[#a09e9a]">{d.icon}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-neutral-900 dark:text-[#f0efed]">{d.label}</p>
                    <p className="mt-0.5 text-[11px] leading-snug text-neutral-500 dark:text-[#66645f]">
                      {d.description}
                    </p>
                  </div>
                  <svg className="h-4 w-4 shrink-0 text-neutral-400 dark:text-[#66645f]" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MenuRowIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden>
      {children}
    </svg>
  );
}

function AccountItem({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[14px] text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-[#a09e9a] dark:hover:bg-neutral-800"
    >
      <svg className="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
        {icon}
      </svg>
      {label}
    </button>
  );
}
