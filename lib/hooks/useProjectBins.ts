'use client';

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProjectBin, User } from '@/lib/types';
import { qk } from '@/lib/queries/keys';
import { fetchJson } from '@/lib/queries/fetchJson';

interface UseProjectBinsProps {
  currentUser: User | null;
}

type BinsData = { bins: ProjectBin[]; totalProjects: number };

const EMPTY_BINS: ProjectBin[] = [];

async function fetchBinsData(): Promise<BinsData> {
  const result = await fetchJson<{ data?: ProjectBin[]; total_projects?: number }>(
    '/api/project-bins'
  );
  return { bins: result.data ?? [], totalProjects: result.total_projects ?? 0 };
}

// Bins live in a shared React Query cache: the ~9 surfaces that mount this
// hook share one fetch, and a mutation from any surface propagates to all of
// them immediately. The public API is unchanged from the useState era.
export function useProjectBins({ currentUser }: UseProjectBinsProps) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: qk.projectBins, queryFn: fetchBinsData });
  const { refetch } = query;

  // Optimistic cache patch shared by the mutators below.
  const patchBins = useCallback(
    (updater: (prev: ProjectBin[]) => ProjectBin[]) => {
      queryClient.setQueryData<BinsData>(qk.projectBins, (old) =>
        old ? { ...old, bins: updater(old.bins) } : old
      );
    },
    [queryClient]
  );

  // `silent` is accepted for backward compatibility; refetches are always
  // silent now — cached data stays visible while fresh data loads.
  const fetchBins = useCallback(
    async (_opts: { silent?: boolean } = {}) => {
      await refetch();
    },
    [refetch]
  );

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
        patchBins(prev => [...prev, result.data]);
        return result.data;
      }
      return null;
    } catch (err) {
      console.error('Error creating bin:', err);
      return null;
    }
  }, [currentUser?.id, patchBins]);

  const updateBin = useCallback(async (binId: string, updates: Partial<Pick<ProjectBin, 'name' | 'description' | 'sort_order' | 'auto_dismiss_enabled' | 'auto_dismiss_days'>>) => {
    try {
      const res = await fetch(`/api/project-bins/${binId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const result = await res.json();
      if (res.ok && result.data) {
        patchBins(prev => prev.map(b => b.id === binId ? { ...b, ...result.data } : b));
      }
    } catch (err) {
      console.error('Error updating bin:', err);
    }
  }, [patchBins]);

  const deleteBin = useCallback(async (binId: string) => {
    try {
      const res = await fetch(`/api/project-bins/${binId}`, { method: 'DELETE' });
      if (res.ok) {
        patchBins(prev => prev.filter(b => b.id !== binId));
        // Refresh to update the unbinned count (flash-free — data stays).
        queryClient.invalidateQueries({ queryKey: qk.projectBins });
      }
    } catch (err) {
      console.error('Error deleting bin:', err);
    }
  }, [patchBins, queryClient]);

  return {
    bins: query.data?.bins ?? EMPTY_BINS,
    loadingBins: query.isLoading,
    totalProjects: query.data?.totalProjects ?? 0,
    fetchBins,
    createBin,
    updateBin,
    deleteBin,
  };
}
