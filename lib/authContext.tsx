'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { createSupabaseClient } from '@/lib/supabaseAuth';

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
  switchUser: (userId: string) => void;
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

const SELECTED_USER_KEY = 'foreshadow_selected_user';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [allUsers, setAllUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createSupabaseClient();

  const fetchAllUsers = async () => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .order('name');

      if (!error && data) {
        setAllUsers(data as AppUser[]);
        return data as AppUser[];
      } else {
        console.error('Error fetching users:', error);
        return [];
      }
    } catch (err) {
      console.error('Error fetching users:', err);
      return [];
    }
  };

  const switchUser = (userId: string) => {
    const selectedUser = allUsers.find(u => u.id === userId);
    if (selectedUser) {
      setAppUser(selectedUser);
      localStorage.setItem(SELECTED_USER_KEY, userId);
    }
  };

  const refreshUser = async () => {
    const users = await fetchAllUsers();
    if (appUser) {
      const refreshedUser = users.find(u => u.id === appUser.id);
      if (refreshedUser) {
        setAppUser(refreshedUser);
      }
    }
  };

  useEffect(() => {
    const init = async () => {
      const users = await fetchAllUsers();
      
      // Check for previously selected user
      const savedUserId = localStorage.getItem(SELECTED_USER_KEY);
      
      if (savedUserId) {
        const savedUser = users.find(u => u.id === savedUserId);
        if (savedUser) {
          setAppUser(savedUser);
        } else if (users.length > 0) {
          setAppUser(users[0]);
        }
      } else if (users.length > 0) {
        // Default to first user
        setAppUser(users[0]);
        localStorage.setItem(SELECTED_USER_KEY, users[0].id);
      }
      
      setLoading(false);
    };

    init();
  }, []);

  const role = appUser?.role ?? null;

  return (
    <AuthContext.Provider value={{
      user: appUser,
      allUsers,
      role,
      loading,
      switchUser,
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
