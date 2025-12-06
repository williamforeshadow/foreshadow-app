'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

// Define your test users
export const TEST_USERS = {
  superadmin: {
    id: 'test-superadmin-001',
    name: 'Sarah Admin',
    email: 'sarah@foreshadow.dev',
    role: 'superadmin' as const,
    avatar: '👑'
  },
  manager: {
    id: 'test-manager-001',
    name: 'Mike Manager',
    email: 'mike@foreshadow.dev',
    role: 'manager' as const,
    avatar: '📋'
  },
  staff: {
    id: 'test-staff-001',
    name: 'Sam Staff',
    email: 'sam@foreshadow.dev',
    role: 'staff' as const,
    avatar: '🧹'
  }
} as const;

export type Role = 'superadmin' | 'manager' | 'staff';
export type TestUser = typeof TEST_USERS[Role];

interface AuthContextType {
  user: TestUser;
  role: Role;
  switchUser: (role: Role) => void;
  // Permission helpers
  canManageUsers: boolean;
  canEditTemplates: boolean;
  canViewAllTasks: boolean;
  canEditTasks: boolean;
  canViewAllProperties: boolean;
  canEditProperties: boolean;
  canManageProjects: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentRole, setCurrentRole] = useState<Role>('superadmin');
  const [isHydrated, setIsHydrated] = useState(false);

  // Persist role selection in localStorage
  useEffect(() => {
    const saved = localStorage.getItem('dev-auth-role');
    if (saved && (saved === 'superadmin' || saved === 'manager' || saved === 'staff')) {
      setCurrentRole(saved);
    }
    setIsHydrated(true);
  }, []);

  const switchUser = (role: Role) => {
    setCurrentRole(role);
    localStorage.setItem('dev-auth-role', role);
  };

  const user = TEST_USERS[currentRole];

  // Define permissions per role
  const permissions = {
    superadmin: {
      canManageUsers: true,
      canEditTemplates: true,
      canViewAllTasks: true,
      canEditTasks: true,
      canViewAllProperties: true,
      canEditProperties: true,
      canManageProjects: true,
    },
    manager: {
      canManageUsers: false,
      canEditTemplates: true,
      canViewAllTasks: true,
      canEditTasks: true,
      canViewAllProperties: true,
      canEditProperties: false,
      canManageProjects: true,
    },
    staff: {
      canManageUsers: false,
      canEditTemplates: false,
      canViewAllTasks: false,
      canEditTasks: false,
      canViewAllProperties: false,
      canEditProperties: false,
      canManageProjects: false,
    }
  };

  // Avoid hydration mismatch by not rendering until client-side
  if (!isHydrated) {
    return null;
  }

  return (
    <AuthContext.Provider value={{
      user,
      role: currentRole,
      switchUser,
      ...permissions[currentRole]
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

