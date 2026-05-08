'use client';

import { memo, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useAuth } from '@/lib/authContext';
import { UserAvatar } from '@/components/ui/user-avatar';

interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
}

const roleColors: Record<string, string> = {
  superadmin: 'bg-purple-500',
  manager: 'bg-blue-500',
  staff: 'bg-emerald-500',
};

// Routes the drawer can navigate to. Active state is derived from the
// current pathname so the drawer stays correct whether it's rendered from
// MobileApp (at /) or from a MobileRouteShell on any other route.
const NAV_ROUTES = {
  home: '/',
  properties: '/properties',
  tasks: '/tasks',
  profile: '/profile',
} as const;

function isActiveRoute(pathname: string | null, route: string): boolean {
  if (!pathname) return false;
  if (route === '/') return pathname === '/';
  return pathname === route || pathname.startsWith(`${route}/`);
}

const MobileDrawer = memo(function MobileDrawer({ open, onClose }: MobileDrawerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, allUsers, role, switchUser } = useAuth();
  const { theme, setTheme } = useTheme();

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
    if (pathname !== path) router.push(path);
  };

  const handleSwitchUser = (id: string) => {
    switchUser(id);
    onClose();
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
        className={`fixed top-0 left-0 bottom-0 z-[61] w-[80%] max-w-[320px] bg-white dark:bg-background border-r border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)] shadow-xl transition-transform duration-300 safe-area-top safe-area-bottom flex flex-col ${
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
            </div>
          </div>
        )}

        {/* Nav items */}
        <nav className="flex-1 overflow-auto hide-scrollbar">
          <div className="py-2">
            <DrawerNavItem
              active={isActiveRoute(pathname, NAV_ROUTES.home)}
              label="Home"
              onClick={() => navigate(NAV_ROUTES.home)}
              icon={
                <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l9-9 9 9M5 10v10h4v-6h6v6h4V10" />
                </svg>
              }
            />
            <DrawerNavItem
              active={isActiveRoute(pathname, NAV_ROUTES.properties)}
              label="Properties"
              onClick={() => navigate(NAV_ROUTES.properties)}
              icon={
                <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
              }
            />
            <DrawerNavItem
              active={isActiveRoute(pathname, NAV_ROUTES.tasks)}
              label="Tasks"
              onClick={() => navigate(NAV_ROUTES.tasks)}
              icon={
                <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
              }
            />
            <DrawerNavItem
              active={isActiveRoute(pathname, NAV_ROUTES.profile)}
              label="Edit Profile"
              onClick={() => navigate(NAV_ROUTES.profile)}
              icon={
                <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              }
            />
          </div>

          {/* Theme toggle */}
          <div className="px-5 py-3 border-t border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)]">
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

          {/* Switch user */}
          {allUsers.length > 1 && (
            <div className="px-5 py-3 border-t border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)]">
              <p className="text-[10px] font-semibold text-neutral-500 dark:text-[#66645f] uppercase tracking-[0.08em] mb-2.5">
                Switch User
              </p>
              <div className="space-y-1">
                {allUsers.map((u) => {
                  const isCurrent = u.id === user?.id;
                  return (
                    <button
                      key={u.id}
                      onClick={() => handleSwitchUser(u.id)}
                      className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left transition-colors ${
                        isCurrent
                          ? 'bg-[rgba(30,25,20,0.04)] dark:bg-[rgba(255,255,255,0.04)]'
                          : 'hover:bg-[rgba(30,25,20,0.02)] dark:hover:bg-[rgba(255,255,255,0.02)]'
                      }`}
                    >
                      <UserAvatar src={u.avatar} name={u.name} size="sm" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-neutral-900 dark:text-[#f0efed] truncate">
                          {u.name}
                        </p>
                        <p className="text-[11px] text-neutral-500 dark:text-[#66645f] capitalize">
                          {u.role}
                        </p>
                      </div>
                      {isCurrent && (
                        <svg className="w-4 h-4 text-neutral-700 dark:text-[#f0efed] flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
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
