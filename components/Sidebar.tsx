'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { ArrowRightToLine, FlaskConical, GraduationCap, PanelLeft, Settings, Sparkles } from 'lucide-react';
import { ModeToggle } from '@/components/mode-toggle';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { UserAvatar } from '@/components/ui/user-avatar';
import { RowsIcon } from '@/components/windows/timeline/TimelineViewIcons';
import { useAiChat } from '@/components/ai-chat/AiChatProvider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  DASHBOARD_VIEW_LABELS,
  DASHBOARD_VIEWS,
  type DashboardView,
} from '@/lib/dashboardViews';
import { useAuth } from '@/lib/authContext';
import { useSidebar } from '@/lib/sidebarContext';

type SidebarProps = {
  surface?: 'default' | 'timeline';
  activeWorkspaceView?: DashboardView;
  onWorkspaceViewChange?: (view: DashboardView) => void;
};

const SIDEBAR_DARK_SURFACE = '#111114';
const SIDEBAR_DARK_BORDER = 'rgba(255,255,255,0.065)';
const SIDEBAR_DARK_HOVER = 'rgba(255,255,255,0.06)';
const SIDEBAR_DARK_ACTIVE = 'rgba(255,255,255,0.10)';
const SIDEBAR_SCROLL_CLASS =
  'overflow-y-auto overflow-x-hidden [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.18)_transparent] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[rgba(255,255,255,0.14)] hover:[&::-webkit-scrollbar-thumb]:bg-[rgba(255,255,255,0.22)]';

const routeItems = [
  {
    name: 'Properties',
    path: '/properties',
    icon: <PropertyIcon />,
  },
  {
    name: 'Templates',
    path: '/templates',
    permission: 'templates',
    icon: (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    name: 'Automations',
    path: '/automations',
    permission: 'templates',
    icon: (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  {
    name: 'Departments',
    path: '/departments',
    permission: 'templates',
    icon: (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
      </svg>
    ),
  },
  {
    name: 'Operations Settings',
    path: '/operations-settings',
    icon: (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

function TurnoverIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m10 17l5-5l-5-5m5 5H3m12-9h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
    </svg>
  );
}

function BinIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
    </svg>
  );
}

function AssignmentIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  );
}

function PropertyIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  );
}

function MessageIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4-.8L3 20l1.3-3.9A7.96 7.96 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  );
}

export default function Sidebar({
  activeWorkspaceView,
  onWorkspaceViewChange,
}: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { isPinned, isReady, pin, unpin } = useSidebar();
  const { user, role, loading, canEditTemplates, signOut } = useAuth();
  const { open: openAiChat, isOpen: isAiChatOpen } = useAiChat();

  // Platform-aware keyboard hint for the Agent row.
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    setIsMac(/mac/i.test(navigator.platform));
  }, []);

  // Hover-peek: the sidebar slides out as an overlay while the cursor is over
  // the flap or the panel, and retreats when it leaves. Pinning is a separate,
  // persisted state; while pinned the peek logic is inert.
  const [isPeeking, setIsPeeking] = useState(false);
  // While the notification dropdown is open, the sidebar stays out (locked)
  // even though the cursor has moved off the panel onto the portaled dropdown.
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const suppressRef = useRef(false);
  const isVisible = isPinned || isPeeking || notificationsOpen;

  const clearHoverTimers = useCallback(() => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearHoverTimers, [clearHoverTimers]);

  // Hovering the flap or the panel opens the peek (after a short hover-intent
  // delay); leaving schedules a close. The flap and panel share these so
  // travelling between them doesn't flicker.
  const handlePeekEnter = useCallback(() => {
    if (isPinned || suppressRef.current) return;
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (openTimerRef.current !== null) return;
    openTimerRef.current = window.setTimeout(() => {
      openTimerRef.current = null;
      setIsPeeking(true);
    }, 120);
  }, [isPinned]);

  const handlePeekLeave = useCallback(() => {
    if (isPinned) return;
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current !== null) return;
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setIsPeeking(false);
    }, 200);
  }, [isPinned]);

  const handlePin = useCallback(() => {
    clearHoverTimers();
    setIsPeeking(false);
    pin();
  }, [clearHoverTimers, pin]);

  const handleUnpin = useCallback(() => {
    clearHoverTimers();
    setIsPeeking(false);
    unpin();
    // The retreating panel passes under the cursor; briefly suppress re-peek
    // so it doesn't immediately pop back out.
    suppressRef.current = true;
    window.setTimeout(() => {
      suppressRef.current = false;
    }, 600);
  }, [clearHoverTimers, unpin]);

  const roleColors: Record<string, string> = {
    superadmin: 'bg-purple-500',
    manager: 'bg-blue-500',
    staff: 'bg-emerald-500',
  };

  const filteredRouteItems = routeItems.filter((item) => {
    if (item.permission === 'templates') return canEditTemplates;
    return true;
  });

  // Messages + its concierge sub-pages live under Workspace. The inbox owns
  // /messages and conversation detail routes; the concierge pages are explicit
  // sub-paths, so the parent row stays inactive while one of them is open.
  // Settings is a sub-path of concierge-training, so detect it first and exclude
  // it from the Training match — otherwise both rows would highlight together.
  const onConciergeSettings = pathname?.startsWith('/messages/concierge-training/settings') ?? false;
  const onConciergeTraining =
    (pathname?.startsWith('/messages/concierge-training') ?? false) && !onConciergeSettings;
  const onConciergeTesting = pathname?.startsWith('/messages/concierge-testing') ?? false;
  const onMessagesInbox =
    pathname === '/messages' ||
    ((pathname?.startsWith('/messages/') ?? false) &&
      !onConciergeTraining &&
      !onConciergeTesting &&
      !onConciergeSettings);
  const messagesSubItems = [
    {
      name: 'Concierge Training',
      path: '/messages/concierge-training',
      active: onConciergeTraining,
      icon: <GraduationCap className="h-4 w-4" />,
    },
    {
      name: 'Concierge Testing',
      path: '/messages/concierge-testing',
      active: onConciergeTesting,
      icon: <FlaskConical className="h-4 w-4" />,
    },
    {
      name: 'Concierge Settings',
      path: '/messages/concierge-training/settings',
      active: onConciergeSettings,
      icon: <Settings className="h-4 w-4" />,
    },
  ];
  const sidebarVars = {
    '--sidebar-dark-surface': SIDEBAR_DARK_SURFACE,
    '--sidebar-dark-border': SIDEBAR_DARK_BORDER,
    '--sidebar-dark-hover': SIDEBAR_DARK_HOVER,
    '--sidebar-dark-active': SIDEBAR_DARK_ACTIVE,
  } as CSSProperties;

  const panelSurfaceClass =
    'dark:bg-[var(--sidebar-dark-surface)] dark:border-[var(--sidebar-dark-border)]';
  const activeRowClass =
    'bg-neutral-100 text-neutral-900 dark:bg-[var(--sidebar-dark-active)] dark:text-white';
  const inactiveRowClass =
    'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-[var(--sidebar-dark-hover)] dark:hover:text-white';
  const sectionMutedClass = 'text-neutral-500 dark:text-neutral-500';
  const handleSignOut = async () => {
    await signOut();
    router.push('/login');
  };

  return (
    <>
    {/* Flow spacer — reserves layout width only when the sidebar is pinned. */}
    <div
      aria-hidden
      className={`h-full shrink-0 ${
        isReady ? 'transition-[width] duration-300 ease-in-out' : ''
      } ${isPinned ? 'w-64' : 'w-0'}`}
    />

    {/* Sidebar panel — a fixed overlay that slides in whenever the sidebar is
        pinned or being peeked. When pinned, the spacer above reserves matching
        layout width so page content isn't covered. */}
    <div
      onMouseEnter={handlePeekEnter}
      onMouseLeave={handlePeekLeave}
      aria-hidden={!isVisible}
      className={`fixed left-0 top-0 z-40 h-full w-64 ${
        isReady ? 'transition-transform duration-300 ease-in-out' : ''
      } ${isVisible ? 'translate-x-0' : '-translate-x-full'}`}
    >
      <div
        className={`w-64 h-full bg-white border-r border-neutral-200 flex flex-col ${panelSurfaceClass} ${
          isPeeking && !isPinned ? 'shadow-2xl' : ''
        }`}
        style={sidebarVars}
      >
        <div className="flex items-center justify-between gap-2 border-b border-neutral-200 px-3 py-2.5 dark:border-[var(--sidebar-dark-border)]">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold leading-5 text-neutral-900 dark:text-white">
              Foreshadow
            </p>
            <p className="truncate text-[11px] leading-4 text-neutral-500 dark:text-neutral-500">
              Workspace
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <NotificationBell onOpenChange={setNotificationsOpen} />
            <button
              type="button"
              onClick={isPinned ? handleUnpin : handlePin}
              tabIndex={isVisible ? 0 : -1}
              aria-label={isPinned ? 'Unpin sidebar' : 'Pin sidebar'}
              title={isPinned ? 'Unpin sidebar' : 'Pin sidebar'}
              className="inline-flex items-center justify-center rounded-md p-1.5 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-[var(--sidebar-dark-hover)] dark:hover:text-white"
            >
              {isPinned ? (
                <PanelLeft className="h-4 w-4" />
              ) : (
                <ArrowRightToLine className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        <nav className={`flex-1 min-w-0 px-2.5 py-3 ${SIDEBAR_SCROLL_CLASS}`}>
            <div className="space-y-3">
            <div className="space-y-0.5">
              <p className={`px-2.5 pb-1 text-[11px] font-medium uppercase tracking-[0.08em] ${sectionMutedClass}`}>
                Workspace
              </p>
              {DASHBOARD_VIEWS.map((view) => {
                const isActive =
                  pathname === '/' && activeWorkspaceView === view;
                return (
                  <button
                    key={view}
                    type="button"
                    onClick={() => {
                      if (onWorkspaceViewChange) {
                        onWorkspaceViewChange(view);
                      } else {
                        router.push(`/?view=${view}`);
                      }
                    }}
                    tabIndex={isVisible ? 0 : -1}
                    className={`flex w-full min-w-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] font-medium transition-colors ${
                      isActive ? activeRowClass : inactiveRowClass
                    }`}
                  >
                    <span className="shrink-0">
                      {view === 'turnovers' ? (
                        <TurnoverIcon />
                      ) : view === 'timeline' ? (
                        <RowsIcon className="h-4 w-4" />
                      ) : view === 'projects' ? (
                        <BinIcon />
                      ) : (
                        <AssignmentIcon />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {DASHBOARD_VIEW_LABELS[view]}
                    </span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={openAiChat}
                tabIndex={isVisible ? 0 : -1}
                className={`flex w-full min-w-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] font-medium transition-colors ${
                  isAiChatOpen ? activeRowClass : inactiveRowClass
                }`}
              >
                <span className="shrink-0">
                  <Sparkles className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1 truncate">Agent</span>
                <kbd className="shrink-0 rounded border border-neutral-300 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500 dark:border-[rgba(255,255,255,0.12)] dark:text-neutral-400">
                  {isMac ? '⌘K' : 'Ctrl K'}
                </kbd>
              </button>

              <Link
                href="/messages"
                tabIndex={isVisible ? 0 : -1}
                className={`flex min-w-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
                  onMessagesInbox ? activeRowClass : inactiveRowClass
                }`}
              >
                <span className="shrink-0">
                  <MessageIcon />
                </span>
                <span className="min-w-0 flex-1 truncate">Messages</span>
              </Link>
              {messagesSubItems.map((sub) => (
                <Link
                  key={sub.path}
                  href={sub.path}
                  tabIndex={isVisible ? 0 : -1}
                  className={`flex min-w-0 items-center gap-2 rounded-md py-1.5 pl-8 pr-2.5 text-[13px] font-medium transition-colors ${
                    sub.active ? activeRowClass : inactiveRowClass
                  }`}
                >
                  <span className="shrink-0">{sub.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{sub.name}</span>
                </Link>
              ))}
            </div>

            <div className="min-w-0">
              <Link
                href="/assignments"
                tabIndex={isVisible ? 0 : -1}
                className={`flex min-w-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
                  pathname === '/assignments' ? activeRowClass : inactiveRowClass
                }`}
              >
                <span className="shrink-0">
                  <UserAvatar
                    src={user?.avatar}
                    name={user?.name || 'Me'}
                    size="xs"
                  />
                </span>
                <span className="min-w-0 flex-1 truncate">My Assignments</span>
              </Link>
            </div>

            <div className="space-y-0.5 pt-1">
              <p className={`px-2.5 pb-1 text-[11px] font-medium uppercase tracking-[0.08em] ${sectionMutedClass}`}>
                Admin
              </p>
              {filteredRouteItems.map((item) => {
                const isActive = pathname === item.path || pathname?.startsWith(`${item.path}/`);
                return (
                  <Link
                    key={item.path}
                    href={item.path}
                    tabIndex={isVisible ? 0 : -1}
                    className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
                      isActive ? activeRowClass : inactiveRowClass
                    }`}
                  >
                    {item.icon}
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  </Link>
                );
              })}
            </div>
            </div>
        </nav>

        <div className="border-t border-neutral-200 dark:border-[var(--sidebar-dark-border)]">
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="w-full flex items-center gap-3 px-3 py-3 hover:bg-neutral-50 transition-colors dark:hover:bg-[var(--sidebar-dark-hover)]"
                  tabIndex={isVisible ? 0 : -1}
                >
                  <UserAvatar src={user.avatar} name={user.name} size="md" />
                  <div className="flex-1 text-left min-w-0">
                    <p className="text-[13px] font-medium text-neutral-900 dark:text-white truncate">
                      {user.name}
                    </p>
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${roleColors[role || 'staff']}`} />
                      <span className="text-[11px] text-neutral-500 dark:text-neutral-400 capitalize">
                        {role}
                      </span>
                    </div>
                  </div>
                  <svg className="w-4 h-4 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
                  </svg>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="start"
                className="w-56 mb-2"
              >
                <div className="px-3 py-2">
                  <p className="text-sm font-medium text-neutral-900 dark:text-white">{user.name}</p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate">{user.email}</p>
                </div>
                <DropdownMenuSeparator />

                <DropdownMenuItem onClick={() => router.push('/profile')}>
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  Edit Profile
                </DropdownMenuItem>

                <DropdownMenuItem onClick={handleSignOut}>
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6A2.25 2.25 0 005.25 5.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
                  </svg>
                  Sign Out
                </DropdownMenuItem>

                <div className="px-2 py-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-neutral-700 dark:text-neutral-300 flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                      </svg>
                      Theme
                    </span>
                    <ModeToggle />
                  </div>
                </div>

              </DropdownMenuContent>
            </DropdownMenu>
          ) : loading ? (
            <div className="flex items-center justify-center px-4 py-4">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-800 dark:border-neutral-700 dark:border-t-white" />
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 px-3 py-3">
              <button
                type="button"
                onClick={() => router.push('/login')}
                className="rounded-md px-2.5 py-1.5 text-[13px] font-medium text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-300 dark:hover:bg-[var(--sidebar-dark-hover)] dark:hover:text-white"
                tabIndex={isVisible ? 0 : -1}
              >
                Sign in
              </button>
              <div className="shrink-0">
                <ModeToggle />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>

    {/* Left-edge hot zone — an invisible full-height strip; moving the cursor
        to the screen's left edge pops the sidebar out. Hidden once visible. */}
    {!isVisible && (
      <div
        aria-hidden
        onMouseEnter={handlePeekEnter}
        onMouseLeave={handlePeekLeave}
        className="fixed left-0 top-0 z-40 h-full w-1.5"
      />
    )}
    </>
  );
}
