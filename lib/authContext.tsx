'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { createSupabaseClient } from '@/lib/supabaseAuth';
import { User } from '@supabase/supabase-js';

export type Role = 'superadmin' | 'manager' | 'staff';

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatar?: string;
}

interface AuthContextType {
  user: AppUser | null;
  authUser: User | null;
  role: Role | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
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

// Define permissions per role
const getPermissions = (r: Role | null) => ({
  canManageUsers: r === 'superadmin',
  canEditTemplates: r === 'superadmin' || r === 'manager',
  canViewAllTasks: r === 'superadmin' || r === 'manager',
  canEditTasks: r === 'superadmin' || r === 'manager',
  canViewAllProperties: r === 'superadmin' || r === 'manager',
  canEditProperties: r === 'superadmin',
  canManageProjects: r === 'superadmin' || r === 'manager',
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createSupabaseClient();

  const fetchAppUser = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

      if (!error && data) {
        setAppUser(data as AppUser);
      } else {
        console.error('Error fetching app user:', error);
        setAppUser(null);
      }
    } catch (err) {
      console.error('Error fetching app user:', err);
      setAppUser(null);
    }
  };

  const refreshUser = async () => {
    if (authUser?.id) {
      await fetchAppUser(authUser.id);
    }
  };

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setAuthUser(session?.user ?? null);
      if (session?.user) {
        fetchAppUser(session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setAuthUser(session?.user ?? null);
        if (session?.user) {
          await fetchAppUser(session.user.id);
        } else {
          setAppUser(null);
        }
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setAppUser(null);
    setAuthUser(null);
  };

  const role = appUser?.role ?? null;

  return (
    <AuthContext.Provider value={{
      user: appUser,
      authUser,
      role,
      loading,
      signOut,
      refreshUser,
      ...getPermissions(role),
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

// ============================================
// DEVELOPMENT ONLY: Role Switcher for Testing
// ============================================
// Keep these test users for development/testing purposes
// You can use the RoleSwitcher component to switch between them

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

export type TestUser = typeof TEST_USERS[Role];
