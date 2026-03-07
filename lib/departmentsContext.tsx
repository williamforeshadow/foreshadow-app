'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import type { Department } from '@/lib/types';

interface DepartmentsContextType {
  departments: Department[];
  loading: boolean;
  /** Map from department_id → icon key for fast lookup */
  deptIconMap: Record<string, string | undefined>;
  /** Refetch departments from the API (e.g. after creating/editing one) */
  refreshDepartments: () => Promise<void>;
}

const DepartmentsContext = createContext<DepartmentsContextType | null>(null);

export function DepartmentsProvider({ children }: { children: ReactNode }) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [deptIconMap, setDeptIconMap] = useState<Record<string, string | undefined>>({});

  const fetchDepartments = useCallback(async () => {
    try {
      const res = await fetch('/api/departments');
      const data = await res.json();
      if (res.ok && data.departments) {
        setDepartments(data.departments);
        setDeptIconMap(
          Object.fromEntries(data.departments.map((d: Department) => [d.id, d.icon]))
        );
      }
    } catch (err) {
      console.error('Error fetching departments:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDepartments();
  }, [fetchDepartments]);

  return (
    <DepartmentsContext.Provider value={{
      departments,
      loading,
      deptIconMap,
      refreshDepartments: fetchDepartments,
    }}>
      {children}
    </DepartmentsContext.Provider>
  );
}

export function useDepartments() {
  const context = useContext(DepartmentsContext);
  if (!context) {
    throw new Error('useDepartments must be used within a DepartmentsProvider');
  }
  return context;
}
