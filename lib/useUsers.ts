'use client';

import { useState, useEffect } from 'react';

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: 'superadmin' | 'manager' | 'staff';
  avatar?: string;
}

export function useUsers() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchUsers() {
      try {
        const res = await fetch('/api/users');
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setUsers(data.data || []);
      } catch (err: any) {
        console.error('Failed to fetch users:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchUsers();
  }, []);

  // Helper to get user by ID
  const getUserById = (id: string | null | undefined): AppUser | undefined => {
    if (!id) return undefined;
    return users.find(u => u.id === id);
  };

  // Helper to get user by name (for backward compatibility during migration)
  const getUserByName = (name: string | null | undefined): AppUser | undefined => {
    if (!name) return undefined;
    return users.find(u => u.name === name);
  };

  // Helper to get multiple users by IDs
  const getUsersByIds = (ids: string[]): AppUser[] => {
    return ids.map(id => users.find(u => u.id === id)).filter(Boolean) as AppUser[];
  };

  return { 
    users, 
    loading, 
    error, 
    getUserById, 
    getUserByName,
    getUsersByIds 
  };
}

