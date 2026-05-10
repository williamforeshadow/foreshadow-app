'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { createSupabaseClient } from '@/lib/supabaseAuth';
import { setActorUserId } from '@/lib/apiFetch';

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
  allUsers: AppUser[];
  role: Role | null;
  loading: boolean;
  error: string | null;
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
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [allUsers, setAllUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const supabase = useMemo(() => createSupabaseClient(), []);

  const fetchAllUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/users', { cache: 'no-store' });
      const result = await res.json();

      if (!res.ok || result.error) {
        console.error('Error fetching users:', result.error);
        setAllUsers([]);
        return [];
      }

      const users = (result.data ?? []) as AppUser[];
      setAllUsers(users);
      return users;
    } catch (err) {
      console.error('Error fetching users:', err);
      setAllUsers([]);
      return [];
    }
  }, []);

  const fetchCurrentUser = useCallback(async () => {
    const res = await fetch('/api/auth/me', { cache: 'no-store' });
    const result = await res.json();

    if (!res.ok || result.error) {
      throw new Error(result.error || 'Unable to load signed-in user');
    }

    return result.user as AppUser;
  }, []);

  const loadSessionUser = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const {
        data: { user: authUser },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !authUser) {
        setAppUser(null);
        setAllUsers([]);
        return;
      }

      const [currentUser] = await Promise.all([
        fetchCurrentUser(),
        fetchAllUsers(),
      ]);
      setAppUser(currentUser);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to load signed-in user';
      console.error('Auth bootstrap failed:', err);
      setAppUser(null);
      setAllUsers([]);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [fetchAllUsers, fetchCurrentUser, supabase]);

  const refreshUser = useCallback(async () => {
    const [currentUser] = await Promise.all([
      fetchCurrentUser(),
      fetchAllUsers(),
    ]);
    setAppUser(currentUser);
    setError(null);
  }, [fetchAllUsers, fetchCurrentUser]);

  const signOut = useCallback(async () => {
    setLoading(true);
    try {
      await supabase.auth.signOut();
    } finally {
      setAppUser(null);
      setAllUsers([]);
      setActorUserId(null);
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void loadSessionUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        void loadSessionUser();
      } else {
        setAppUser(null);
        setAllUsers([]);
        setActorUserId(null);
        setLoading(false);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [loadSessionUser, supabase]);

  const role = appUser?.role ?? null;

  // Publish the active user into the apiFetch singleton so every
  // property-knowledge fetch (and any other route that reads the
  // `x-actor-user-id` header) gets attributed without each call site
  // having to thread the user through manually.
  useEffect(() => {
    setActorUserId(appUser?.id ?? null);
  }, [appUser?.id]);

  return (
    <AuthContext.Provider value={{
      user: appUser,
      allUsers,
      role,
      loading,
      error,
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
