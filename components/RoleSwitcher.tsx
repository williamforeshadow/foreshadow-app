'use client';

import { useState } from 'react';
import { useAuth, TEST_USERS, Role } from '@/lib/authContext';
import { useIsMobile } from '@/lib/useIsMobile';

export default function RoleSwitcher() {
  const { user, role, switchUser } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const isMobile = useIsMobile();

  const roles: Role[] = ['superadmin', 'manager', 'staff'];

  const roleColors = {
    superadmin: 'bg-purple-500',
    manager: 'bg-blue-500',
    staff: 'bg-emerald-500'
  };

  const roleBorderColors = {
    superadmin: 'border-purple-400 bg-purple-50 dark:bg-purple-950/80',
    manager: 'border-blue-400 bg-blue-50 dark:bg-blue-950/80',
    staff: 'border-emerald-400 bg-emerald-50 dark:bg-emerald-950/80'
  };

  const roleDescriptions = {
    superadmin: 'Full access to everything',
    manager: 'Manage tasks, templates & staff',
    staff: 'View & complete assigned tasks'
  };

  // Compact mobile version
  if (isMobile) {
    return (
      <div className="fixed top-2 right-2 z-50">
        {/* Expanded Panel */}
        {isOpen && (
          <>
            {/* Backdrop */}
            <div 
              className="fixed inset-0 bg-black/20 dark:bg-black/40" 
              onClick={() => setIsOpen(false)}
            />
            
            {/* Panel */}
            <div className={`absolute top-10 right-0 p-3 rounded-lg border shadow-xl ${roleBorderColors[role]} backdrop-blur-md`}>
              <div className="text-[10px] font-semibold text-neutral-500 dark:text-neutral-400 mb-2 uppercase tracking-wide flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                Switch Role
              </div>
              <div className="space-y-1 min-w-[160px]">
                {roles.map((r) => {
                  const testUser = TEST_USERS[r];
                  const isActive = r === role;
                  return (
                    <button
                      key={r}
                      onClick={() => {
                        switchUser(r);
                        setIsOpen(false);
                      }}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-all text-left ${
                        isActive
                          ? 'bg-white dark:bg-neutral-800 shadow ring-1 ring-neutral-900 dark:ring-white'
                          : 'hover:bg-white/70 dark:hover:bg-neutral-800/70'
                      }`}
                    >
                      <span className="text-base">{testUser.avatar}</span>
                      <span className="font-medium text-neutral-900 dark:text-white text-xs capitalize">
                        {r}
                      </span>
                      {isActive && (
                        <span className="text-green-500 text-xs ml-auto">✓</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* Compact Toggle Button */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`flex items-center gap-1 px-2 py-1 rounded-full shadow-md border text-xs transition-all hover:scale-105 active:scale-95 ${roleBorderColors[role]}`}
        >
          <span className="text-sm">{user.avatar}</span>
          <span className={`w-2 h-2 rounded-full ${roleColors[role]}`} />
        </button>
      </div>
    );
  }

  // Desktop version (unchanged)
  return (
    <div className="fixed bottom-4 right-4 z-50">
      {/* Expanded Panel */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 bg-black/20 dark:bg-black/40" 
            onClick={() => setIsOpen(false)}
          />
          
          {/* Panel */}
          <div className={`relative mb-2 p-4 rounded-xl border-2 shadow-2xl ${roleBorderColors[role]} backdrop-blur-md`}>
            <div className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 mb-3 uppercase tracking-wide flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              Dev Mode • Switch Account
            </div>
            <div className="space-y-2 min-w-[220px]">
              {roles.map((r) => {
                const testUser = TEST_USERS[r];
                const isActive = r === role;
                return (
                  <button
                    key={r}
                    onClick={() => {
                      switchUser(r);
                      setIsOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all ${
                      isActive
                        ? 'bg-white dark:bg-neutral-800 shadow-md ring-2 ring-neutral-900 dark:ring-white'
                        : 'hover:bg-white/70 dark:hover:bg-neutral-800/70'
                    }`}
                  >
                    <span className="text-2xl">{testUser.avatar}</span>
                    <div className="text-left flex-1">
                      <div className="font-medium text-neutral-900 dark:text-white text-sm">
                        {testUser.name}
                      </div>
                      <div className="text-xs text-neutral-500 dark:text-neutral-400">
                        {roleDescriptions[r]}
                      </div>
                    </div>
                    {isActive && (
                      <span className="text-green-500 text-lg">✓</span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 pt-3 border-t border-neutral-200 dark:border-neutral-700">
              <p className="text-xs text-neutral-400 dark:text-neutral-500 text-center">
                No real auth • Changes persist locally
              </p>
            </div>
          </div>
        </>
      )}

      {/* Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`relative flex items-center gap-2.5 px-4 py-2.5 rounded-full shadow-lg border-2 transition-all hover:scale-105 active:scale-95 ${roleBorderColors[role]}`}
      >
        <span className="text-xl">{user.avatar}</span>
        <div className="text-left">
          <span className="font-medium text-neutral-900 dark:text-white text-sm block leading-tight">
            {user.name}
          </span>
          <span className="text-xs text-neutral-500 dark:text-neutral-400 capitalize">
            {role}
          </span>
        </div>
        <span className={`w-2.5 h-2.5 rounded-full ${roleColors[role]} ml-1`} />
      </button>
    </div>
  );
}

