'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Fragment, type CSSProperties } from 'react';
import { ModeToggle } from '@/components/mode-toggle';
import { SidebarToggleButton } from '@/components/SidebarToggleButton';
import { UserAvatar } from '@/components/ui/user-avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import {
  DASHBOARD_VIEW_LABELS,
  DASHBOARD_VIEWS,
  type DashboardView,
} from '@/lib/dashboardViews';
import { useAuth } from '@/lib/authContext';
import { useKanbanTexture } from '@/lib/hooks/useKanbanTexture';
import { useSidebar } from '@/lib/sidebarContext';
import { assignmentTaskPath } from '@/src/lib/links';

type SidebarProps = {
  surface?: 'default' | 'timeline';
  activeWorkspaceView?: DashboardView;
  onWorkspaceViewChange?: (view: DashboardView) => void;
};

const SIDEBAR_DARK_SURFACE = '#111114';
const SIDEBAR_DARK_LIFTED_SURFACE = '#17171B';
const SIDEBAR_DARK_BORDER = 'rgba(255,255,255,0.065)';
const SIDEBAR_DARK_HOVER = 'rgba(255,255,255,0.06)';
const SIDEBAR_DARK_ACTIVE = 'rgba(255,255,255,0.10)';
const SIDEBAR_DARK_SEPARATOR = 'rgba(255,255,255,0.055)';
const SIDEBAR_SCROLL_CLASS =
  'overflow-y-auto overflow-x-hidden [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.18)_transparent] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[rgba(255,255,255,0.14)] hover:[&::-webkit-scrollbar-thumb]:bg-[rgba(255,255,255,0.22)]';

const routeItems = [
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

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

function WorkspaceIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
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

export default function Sidebar({
  activeWorkspaceView,
  onWorkspaceViewChange,
}: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const {
    isOpen,
    isReady,
    workspaceOpen,
    setWorkspaceOpen,
    assignmentsOpen,
    setAssignmentsOpen,
    propertiesOpen,
    setPropertiesOpen,
    assignmentState,
    assignments,
    propertyState,
    properties,
  } = useSidebar();
  const { user, allUsers, role, canEditTemplates, switchUser } = useAuth();
  const kanbanTexture = useKanbanTexture();

  const roleColors: Record<string, string> = {
    superadmin: 'bg-purple-500',
    manager: 'bg-blue-500',
    staff: 'bg-emerald-500',
  };

  const filteredRouteItems = routeItems.filter((item) => {
    if (item.permission === 'templates') return canEditTemplates;
    return true;
  });
  const sidebarVars = {
    '--sidebar-dark-surface': SIDEBAR_DARK_SURFACE,
    '--sidebar-dark-lifted-surface': SIDEBAR_DARK_LIFTED_SURFACE,
    '--sidebar-dark-border': SIDEBAR_DARK_BORDER,
    '--sidebar-dark-hover': SIDEBAR_DARK_HOVER,
    '--sidebar-dark-active': SIDEBAR_DARK_ACTIVE,
    '--sidebar-dark-separator': SIDEBAR_DARK_SEPARATOR,
  } as CSSProperties;

  const panelSurfaceClass =
    'dark:bg-[var(--sidebar-dark-surface)] dark:border-[var(--sidebar-dark-border)]';
  const activeRowClass =
    'bg-neutral-100 text-neutral-900 dark:bg-[var(--sidebar-dark-active)] dark:text-white';
  const inactiveRowClass =
    'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-[var(--sidebar-dark-hover)] dark:hover:text-white';
  const nestedActiveClass =
    'bg-neutral-100 text-neutral-900 dark:bg-[var(--sidebar-dark-active)] dark:text-white';
  const nestedInactiveClass =
    'text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-[var(--sidebar-dark-hover)] dark:hover:text-white';
  const sectionMutedClass = 'text-neutral-500 dark:text-neutral-500';

  return (
    <div
      className={`h-full overflow-hidden flex-shrink-0 ${
        isReady ? 'transition-[width] duration-300 ease-in-out' : ''
      } ${isOpen ? 'w-64' : 'w-0'}`}
      aria-hidden={!isOpen}
    >
      <div
        className={`w-64 h-full bg-white border-r border-neutral-200 flex flex-col ${panelSurfaceClass}`}
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
          <SidebarToggleButton className="dark:hover:bg-[var(--sidebar-dark-hover)]" />
        </div>

        <nav className={`flex-1 min-w-0 px-2.5 py-3 ${SIDEBAR_SCROLL_CLASS}`}>
            <div className="space-y-3">
            <div className="min-w-0">
              <button
                type="button"
                onClick={() => setWorkspaceOpen((open) => !open)}
                tabIndex={isOpen ? 0 : -1}
                className={`flex w-full min-w-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] font-medium transition-colors ${
                  pathname === '/' ? activeRowClass : inactiveRowClass
                }`}
                aria-expanded={workspaceOpen}
              >
                <Chevron open={workspaceOpen} />
                <WorkspaceIcon />
                <span className="min-w-0 flex-1 truncate">Workspace</span>
              </button>

              {workspaceOpen && (
                <div className="mt-1 w-full min-w-0 max-w-full pl-8 pr-1">
                  <div className={`h-36 w-full min-w-0 max-w-full rounded-md border border-neutral-200/70 bg-neutral-50/80 dark:border-[var(--sidebar-dark-border)] dark:bg-[var(--sidebar-dark-lifted-surface)] ${SIDEBAR_SCROLL_CLASS}`}>
                    <div className="w-full min-w-0 max-w-full overflow-hidden p-1">
                      {DASHBOARD_VIEWS.map((view, index) => {
                        const isActive = pathname === '/' && activeWorkspaceView === view;
                        return (
                          <Fragment key={view}>
                            <button
                              type="button"
                              onClick={() => {
                                if (onWorkspaceViewChange) {
                                  onWorkspaceViewChange(view);
                                } else {
                                  router.push(`/?view=${view}`);
                                }
                              }}
                              tabIndex={isOpen ? 0 : -1}
                              className={`flex w-full min-w-0 max-w-full overflow-hidden rounded-md px-2.5 py-1.5 text-left text-[12px] leading-4 transition-colors ${
                                isActive ? nestedActiveClass : nestedInactiveClass
                              }`}
                              title={DASHBOARD_VIEW_LABELS[view]}
                            >
                              <span className="block min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                                {DASHBOARD_VIEW_LABELS[view]}
                              </span>
                            </button>
                            {index < DASHBOARD_VIEWS.length - 1 && (
                              <Separator className="mx-2 my-0 bg-neutral-200/70 dark:bg-[var(--sidebar-dark-separator)]" />
                            )}
                          </Fragment>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setAssignmentsOpen((open) => !open)}
                  tabIndex={isOpen ? 0 : -1}
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors ${inactiveRowClass}`}
                  aria-label={assignmentsOpen ? 'Collapse assignments' : 'Expand assignments'}
                  aria-expanded={assignmentsOpen}
                >
                  <Chevron open={assignmentsOpen} />
                </button>
                <Link
                  href="/assignments"
                  tabIndex={isOpen ? 0 : -1}
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
                    pathname === '/assignments' ? activeRowClass : inactiveRowClass
                  }`}
                >
                  <span className="shrink-0"><AssignmentIcon /></span>
                  <span className="min-w-0 flex-1 truncate">My Assignments</span>
                </Link>
              </div>

              {assignmentsOpen && (
                <div className="mt-1 w-full min-w-0 max-w-full pl-8 pr-1">
                  <div className={`h-44 w-full min-w-0 max-w-full rounded-md border border-neutral-200/70 bg-neutral-50/80 dark:border-[var(--sidebar-dark-border)] dark:bg-[var(--sidebar-dark-lifted-surface)] ${SIDEBAR_SCROLL_CLASS}`}>
                    <div className="w-full min-w-0 max-w-full overflow-hidden p-1">
                      {assignmentState === 'loading' && (
                        <p className={`px-2.5 py-1.5 text-[12px] ${sectionMutedClass}`}>Loading...</p>
                      )}
                      {assignmentState === 'error' && (
                        <p className={`px-2.5 py-1.5 text-[12px] ${sectionMutedClass}`}>Unable to load</p>
                      )}
                      {assignmentState === 'ready' && assignments.length === 0 && (
                        <p className={`px-2.5 py-1.5 text-[12px] ${sectionMutedClass}`}>No assignments</p>
                      )}
                      {assignments.map((task, index) => {
                        const id = task.task_id ?? task.id;
                        const label = task.title || task.template_name || 'Untitled task';
                        const row = id ? (
                          <Link
                            href={assignmentTaskPath(id)}
                            tabIndex={isOpen ? 0 : -1}
                            className={`flex w-full min-w-0 max-w-full overflow-hidden rounded-md px-2.5 py-1.5 text-[12px] leading-4 transition-colors ${nestedInactiveClass}`}
                            title={label}
                          >
                            <span className="block min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                              {label}
                            </span>
                          </Link>
                        ) : (
                          <span
                            className={`flex w-full min-w-0 max-w-full overflow-hidden rounded-md px-2.5 py-1.5 text-[12px] leading-4 ${sectionMutedClass}`}
                            title={label}
                          >
                            <span className="block min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                              {label}
                            </span>
                          </span>
                        );

                        return (
                          <Fragment key={id ?? `${label}-${index}`}>
                            {row}
                            {index < assignments.length - 1 && (
                              <Separator className="mx-2 my-0 bg-neutral-200/70 dark:bg-[var(--sidebar-dark-separator)]" />
                            )}
                          </Fragment>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPropertiesOpen((open) => !open)}
                  tabIndex={isOpen ? 0 : -1}
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors ${inactiveRowClass}`}
                  aria-label={propertiesOpen ? 'Collapse properties' : 'Expand properties'}
                  aria-expanded={propertiesOpen}
                >
                  <Chevron open={propertiesOpen} />
                </button>
                <Link
                  href="/properties"
                  tabIndex={isOpen ? 0 : -1}
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
                    pathname?.startsWith('/properties') ? activeRowClass : inactiveRowClass
                  }`}
                >
                  <span className="shrink-0"><PropertyIcon /></span>
                  <span className="min-w-0 flex-1 truncate">Properties</span>
                </Link>
              </div>

              {propertiesOpen && (
                <div className="mt-1 w-full min-w-0 max-w-full pl-8 pr-1">
                  <div className={`h-44 w-full min-w-0 max-w-full rounded-md border border-neutral-200/70 bg-neutral-50/80 dark:border-[var(--sidebar-dark-border)] dark:bg-[var(--sidebar-dark-lifted-surface)] ${SIDEBAR_SCROLL_CLASS}`}>
                    <div className="w-full min-w-0 max-w-full overflow-hidden p-1">
                      {propertyState === 'loading' && (
                        <p className={`px-2.5 py-1.5 text-[12px] ${sectionMutedClass}`}>Loading...</p>
                      )}
                      {propertyState === 'error' && (
                        <p className={`px-2.5 py-1.5 text-[12px] ${sectionMutedClass}`}>Unable to load</p>
                      )}
                      {propertyState === 'ready' && properties.length === 0 && (
                        <p className={`px-2.5 py-1.5 text-[12px] ${sectionMutedClass}`}>No properties</p>
                      )}
                      {properties.map((property, index) => (
                        <Fragment key={property.id}>
                          <Link
                            href={`/properties/${property.id}`}
                            tabIndex={isOpen ? 0 : -1}
                            className={`flex w-full min-w-0 max-w-full overflow-hidden rounded-md px-2.5 py-1.5 text-[12px] leading-4 transition-colors ${
                              pathname === `/properties/${property.id}` ? nestedActiveClass : nestedInactiveClass
                            }`}
                            title={property.name}
                          >
                            <span className="block min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                              {property.name}
                            </span>
                          </Link>
                          {index < properties.length - 1 && (
                            <Separator className="mx-2 my-0 bg-neutral-200/70 dark:bg-[var(--sidebar-dark-separator)]" />
                          )}
                        </Fragment>
                      ))}
                    </div>
                  </div>
                </div>
              )}
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
                    tabIndex={isOpen ? 0 : -1}
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
                  tabIndex={isOpen ? 0 : -1}
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

                <div className="px-2 py-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-neutral-700 dark:text-neutral-300 flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
                      </svg>
                      Texture
                    </span>
                    <button
                      type="button"
                      onClick={kanbanTexture.toggle}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        kanbanTexture.enabled ? 'bg-neutral-800 dark:bg-white' : 'bg-neutral-300 dark:bg-neutral-600'
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform dark:bg-[#111114] ${
                          kanbanTexture.enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {allUsers.length > 1 && (
                  <>
                    <DropdownMenuSeparator />
                    <div className="px-3 py-2">
                      <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2">Switch User</p>
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {allUsers.map((u) => (
                          <button
                            key={u.id}
                            type="button"
                            onClick={() => switchUser(u.id)}
                            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-sm transition-colors ${
                              u.id === user?.id
                                ? 'bg-primary/10 text-primary'
                                : 'hover:bg-neutral-100 dark:hover:bg-[rgba(255,255,255,0.06)]'
                            }`}
                          >
                            <UserAvatar src={u.avatar} name={u.name} size="sm" />
                            <div className="flex-1 min-w-0">
                              <p className="truncate font-medium">{u.name}</p>
                              <p className="text-xs text-neutral-500 capitalize">{u.role}</p>
                            </div>
                            {u.id === user?.id && (
                              <svg className="w-4 h-4 text-primary" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className="px-4 py-4">
              <div className="flex items-center justify-center">
                <ModeToggle />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
