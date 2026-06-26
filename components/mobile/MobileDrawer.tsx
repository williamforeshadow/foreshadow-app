'use client';

import { memo, useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useAuth } from '@/lib/authContext';
import { UserAvatar } from '@/components/ui/user-avatar';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { useAiChat } from '@/components/ai-chat/AiChatProvider';

interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
}

const roleColors: Record<string, string> = {
  superadmin: 'bg-purple-500',
  manager: 'bg-blue-500',
  staff: 'bg-emerald-500',
  vendor: 'bg-amber-500',
};

// Tab params drive the in-/ view switcher. Drawer items navigate cross-route
// by routing back to '/' with the appropriate ?tab=. MobileApp reads the
// search param to decide which view to render.
type WorkspaceTab = 'timeline' | 'projects' | 'assignments';

function isActiveRoute(pathname: string | null, route: string): boolean {
  if (!pathname) return false;
  if (route === '/') return pathname === '/';
  return pathname === route || pathname.startsWith(`${route}/`);
}

const MobileDrawer = memo(function MobileDrawer({ open, onClose }: MobileDrawerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, role, canEditTemplates, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const { open: openAiChat } = useAiChat();

  const currentTab = searchParams?.get('tab') ?? null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [open]);

  const navigate = (path: string) => {
    onClose();
    // Avoid noisy history entries when tapping the route you're already on.
    const current = pathname + (searchParams?.toString() ? `?${searchParams.toString()}` : '');
    if (current !== path) router.push(path);
  };

  const handleAgent = () => {
    onClose();
    openAiChat();
  };

  const handleSignOut = async () => {
    await signOut();
    onClose();
    router.push('/login');
  };

  // Active state for tab-switching items: only when at '/' AND the current
  // ?tab= matches (or assignments is the default when no ?tab= is set).
  const isTabActive = (tab: WorkspaceTab) => {
    if (pathname !== '/') return false;
    if (tab === 'assignments') return currentTab === null || currentTab === 'assignments';
    return currentTab === tab;
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm transition-opacity duration-300 ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <aside
        className={`fixed top-0 left-0 bottom-0 z-[61] w-[80%] max-w-[320px] bg-white dark:bg-background border-r border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)] shadow-xl transition-transform duration-300 safe-area-top flex flex-col ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
      >
        {/* User header */}
        {user && (
          <div className="px-5 pt-5 pb-4 border-b border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)]">
            <div className="flex items-center gap-3">
              <UserAvatar src={user.avatar} name={user.name} size="md" />
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-medium text-neutral-900 dark:text-[#f0efed] truncate">
                  {user.name}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className={`w-[6px] h-[6px] rounded-full ${roleColors[role || 'staff']}`} />
                  <span className="text-[11px] text-neutral-500 dark:text-[#66645f] capitalize tracking-[0.02em]">
                    {role}
                  </span>
                </div>
              </div>
              <NotificationBell compact />
            </div>
          </div>
        )}

        {/* Nav body */}
        <nav className="flex-1 overflow-auto hide-scrollbar">
          {/* Workspace section */}
          <div className="pt-3">
            <p className="px-5 pb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-neutral-400 dark:text-[#66645f]">
              Workspace
            </p>
            <DrawerNavItem
              active={isTabActive('timeline')}
              label="Schedule"
              onClick={() => navigate('/?tab=timeline')}
              icon={
                <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              }
            />
            <DrawerNavItem
              active={isTabActive('projects')}
              label="Bins"
              onClick={() => navigate('/?tab=projects')}
              icon={
                <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                  <rect x="3" y="3" width="7" height="18" rx="1" />
                  <rect x="14" y="3" width="7" height="11" rx="1" />
                </svg>
              }
            />
            <DrawerNavItem
              active={isActiveRoute(pathname, '/tasks')}
              label="Tasks"
              onClick={() => navigate('/tasks')}
              icon={
                <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
              }
            />
            <DrawerNavItem
              active={isActiveRoute(pathname, '/messages')}
              label="Messages"
              onClick={() => navigate('/messages')}
              icon={
                <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4-.8L3 20l1.3-3.9A7.96 7.96 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              }
            />
            <DrawerNavItem
              active={false}
              label="Agent"
              onClick={handleAgent}
              icon={
                <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l1.7 4.6L18 9l-4.3 1.4L12 15l-1.7-4.6L6 9l4.3-1.4zM19 14l.9 2.3L22 17l-2.1.7L19 20l-.9-2.3L16 17l2.1-.7z" />
                </svg>
              }
            />
          </div>

          {/* My Assignments — own section, no header */}
          <div className="pt-3 mt-3 border-t border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)]">
            <DrawerNavItem
              active={isTabActive('assignments')}
              label="My Assignments"
              onClick={() => navigate('/')}
              icon={
                <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              }
            />
          </div>

          {/* Admin section (gated) */}
          {canEditTemplates && (
            <div className="pt-3 mt-3 border-t border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)]">
              <p className="px-5 pb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-neutral-400 dark:text-[#66645f]">
                Admin
              </p>
              <DrawerNavItem
                active={isActiveRoute(pathname, '/properties')}
                label="Properties"
                onClick={() => navigate('/properties')}
                icon={
                  <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                  </svg>
                }
              />
            </div>
          )}

          {/* Profile section */}
          <div className="pt-3 mt-3 border-t border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)]">
            <DrawerNavItem
              active={isActiveRoute(pathname, '/profile')}
              label="Edit Profile"
              onClick={() => navigate('/profile')}
              icon={
                <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              }
            />
            <DrawerNavItem
              active={false}
              label="Sign Out"
              onClick={handleSignOut}
              icon={
                <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6A2.25 2.25 0 005.25 5.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
                </svg>
              }
            />
          </div>

          {/* Theme toggle */}
          <div className="px-5 py-3 mt-3 border-t border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)]">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-neutral-700 dark:text-[#a09e9a] flex items-center gap-2.5">
                <svg className="w-[16px] h-[16px]" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
                Theme
              </span>
              <button
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className={`relative inline-flex h-[22px] w-[40px] items-center rounded-full transition-colors ${
                  theme === 'dark' ? 'bg-neutral-200 dark:bg-[#f0efed]' : 'bg-neutral-300'
                }`}
                aria-label="Toggle theme"
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full bg-white dark:bg-background transition-transform ${
                    theme === 'dark' ? 'translate-x-[20px]' : 'translate-x-[3px]'
                  }`}
                />
              </button>
            </div>
          </div>
        </nav>
      </aside>
    </>
  );
});

function DrawerNavItem({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-5 py-3 text-left transition-colors ${
        active
          ? 'bg-[rgba(30,25,20,0.04)] dark:bg-[rgba(255,255,255,0.04)] text-neutral-900 dark:text-[#f0efed]'
          : 'text-neutral-700 dark:text-[#a09e9a] hover:bg-[rgba(30,25,20,0.02)] dark:hover:bg-[rgba(255,255,255,0.02)]'
      }`}
    >
      <span className={active ? 'text-neutral-900 dark:text-[#f0efed]' : 'text-neutral-500 dark:text-[#66645f]'}>
        {icon}
      </span>
      <span className="text-[14px] font-medium tracking-tight">{label}</span>
    </button>
  );
}

export default MobileDrawer;
