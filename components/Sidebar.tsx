'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { ModeToggle } from '@/components/mode-toggle';
import { useAuth } from '@/lib/authContext';
import { UserAvatar } from '@/components/ui/user-avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(true);
  const { user, role, canEditTemplates, signOut } = useAuth();

  const allNavItems = [
    {
      name: 'Dashboard',
      path: '/',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      )
    },
    {
      name: 'Templates',
      path: '/templates',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      )
    },
    {
      name: 'Staff Portal',
      path: '/staff',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      )
    }
  ];

  // Filter out Templates for staff users
  const navItems = allNavItems.filter(item => {
    if (item.path === '/templates') return canEditTemplates;
    return true;
  });

  const roleColors: Record<string, string> = {
    superadmin: 'bg-purple-500',
    manager: 'bg-blue-500',
    staff: 'bg-emerald-500'
  };

  return (
    <>
      {/* Sidebar */}
      <div className={`${isOpen ? 'w-64' : 'w-16'} h-screen bg-white dark:bg-neutral-900 border-r border-neutral-200 dark:border-neutral-800 flex flex-col transition-all duration-300 relative`}>
        {/* Toggle Button */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="absolute -right-3 top-6 w-6 h-6 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-full flex items-center justify-center text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors shadow-sm"
        >
          <svg 
            className={`w-4 h-4 transition-transform duration-300 ${isOpen ? '' : 'rotate-180'}`} 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {/* Logo/Title */}
        <div className={`p-6 border-b border-neutral-200 dark:border-neutral-800 ${isOpen ? '' : 'px-3'}`}>
          {isOpen ? (
            <>
              <h1 className="text-xl font-bold text-neutral-900 dark:text-white flex items-center gap-2">
                Property Management
                <svg className="w-4 h-4 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              </h1>
            </>
          ) : (
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 text-center">
              F
            </div>
          )}
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 p-4">
          <div className="space-y-2">
            {navItems.map((item) => {
              const isActive = pathname === item.path;
              return (
                <Link
                  key={item.path}
                  href={item.path}
                  className={`flex items-center ${isOpen ? 'gap-3 px-4' : 'justify-center px-2'} py-3 rounded-lg transition-colors ${
                    isActive
                      ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white font-semibold'
                      : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-white'
                  }`}
                  title={!isOpen ? item.name : undefined}
                >
                  {item.icon}
                  {isOpen && <span>{item.name}</span>}
                </Link>
              );
            })}
          </div>
        </nav>

        {/* User Profile Section */}
        <div className="border-t border-neutral-200 dark:border-neutral-800">
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button 
                  className={`w-full flex items-center ${isOpen ? 'gap-3 px-4' : 'justify-center px-2'} py-4 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors`}
                  title={!isOpen ? user.name : undefined}
                >
                  <UserAvatar src={user.avatar} name={user.name} size="md" />
                  {isOpen && (
                    <div className="flex-1 text-left min-w-0">
                      <p className="text-sm font-medium text-neutral-900 dark:text-white truncate">
                        {user.name}
                      </p>
                      <div className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${roleColors[role || 'staff']}`} />
                        <span className="text-xs text-neutral-500 dark:text-neutral-400 capitalize">
                          {role}
                        </span>
                      </div>
                    </div>
                  )}
                  {isOpen && (
                    <svg className="w-4 h-4 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
                    </svg>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent 
                side={isOpen ? "top" : "right"} 
                align={isOpen ? "start" : "center"}
                className="w-56 mb-2"
              >
                {/* User Info Header */}
                <div className="px-3 py-2">
                  <p className="text-sm font-medium text-neutral-900 dark:text-white">{user.name}</p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate">{user.email}</p>
                </div>
                <DropdownMenuSeparator />
                
                {/* Edit Profile */}
                <DropdownMenuItem onClick={() => router.push('/profile')}>
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  Edit Profile
                </DropdownMenuItem>
                
                {/* Theme Toggle */}
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
                
                <DropdownMenuSeparator />
                
                {/* Sign Out */}
                <DropdownMenuItem 
                  onClick={async () => {
                    await signOut();
                    router.push('/login');
                  }}
                  className="text-red-600 dark:text-red-400 focus:text-red-600 dark:focus:text-red-400"
                >
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className={`${isOpen ? 'px-4' : 'px-2'} py-4`}>
              <button
                onClick={() => router.push('/login')}
                className={`w-full flex items-center ${isOpen ? 'gap-3 justify-start' : 'justify-center'} py-2 px-3 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-all`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                </svg>
                {isOpen && <span className="font-medium">Sign In</span>}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
