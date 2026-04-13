'use client';

import { useState, useCallback, useEffect } from 'react';
import type { ProjectBin, User } from '@/lib/types';

interface UseProjectBinsProps {
  currentUser: User | null;
}

export function useProjectBins({ currentUser }: UseProjectBinsProps) {
  const [bins, setBins] = useState<ProjectBin[]>([]);
  const [loadingBins, setLoadingBins] = useState(false);
  const [totalProjects, setTotalProjects] = useState(0);

  const fetchBins = useCallback(async () => {
    setLoadingBins(true);
    try {
      const res = await fetch('/api/project-bins');
      const result = await res.json();
      if (res.ok && result.data) {
        setBins(result.data);
        setTotalProjects(result.total_projects || 0);
      }
    } catch (err) {
      console.error('Error fetching bins:', err);
    } finally {
      setLoadingBins(false);
    }
  }, []);

  const createBin = useCallback(async (name: string, description?: string): Promise<ProjectBin | null> => {
    try {
      const res = await fetch('/api/project-bins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description: description || null,
          created_by: currentUser?.id || null,
        }),
      });
      const result = await res.json();
      if (res.ok && result.data) {
        setBins(prev => [...prev, result.data]);
        return result.data;
      }
      return null;
    } catch (err) {
      console.error('Error creating bin:', err);
      return null;
    }
  }, [currentUser?.id]);

  const updateBin = useCallback(async (binId: string, updates: Partial<Pick<ProjectBin, 'name' | 'description' | 'sort_order'>>) => {
    try {
      const res = await fetch(`/api/project-bins/${binId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const result = await res.json();
      if (res.ok && result.data) {
        setBins(prev => prev.map(b => b.id === binId ? { ...b, ...result.data } : b));
      }
    } catch (err) {
      console.error('Error updating bin:', err);
    }
  }, []);

  const deleteBin = useCallback(async (binId: string) => {
    try {
      const res = await fetch(`/api/project-bins/${binId}`, { method: 'DELETE' });
      if (res.ok) {
        setBins(prev => prev.filter(b => b.id !== binId));
        // Refresh to update unbinned count
        fetchBins();
      }
    } catch (err) {
      console.error('Error deleting bin:', err);
    }
  }, [fetchBins]);

  // Auto-load on mount
  useEffect(() => {
    fetchBins();
  }, [fetchBins]);

  return {
    bins,
    loadingBins,
    totalProjects,
    fetchBins,
    createBin,
    updateBin,
    deleteBin,
  };
}
