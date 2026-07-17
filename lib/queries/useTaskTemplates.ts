'use client';

import { useQuery } from '@tanstack/react-query';
import type { TaskTemplate } from '@/lib/types';
import { qk } from './keys';
import { fetchJson } from './fetchJson';

const EMPTY: TaskTemplate[] = [];

export async function fetchTaskTemplates(): Promise<TaskTemplate[]> {
  const json = await fetchJson<{ data?: TaskTemplate[] }>('/api/tasks');
  return json.data ?? [];
}

// Shared, cached task-template picker list (GET /api/tasks). Lazy call sites
// use queryClient.ensureQueryData({ queryKey: qk.taskTemplates, queryFn:
// fetchTaskTemplates }) to keep their on-demand timing while sharing this
// cache.
export function useTaskTemplates({ enabled = true }: { enabled?: boolean } = {}) {
  const query = useQuery({
    queryKey: qk.taskTemplates,
    queryFn: fetchTaskTemplates,
    enabled,
  });
  return {
    templates: query.data ?? EMPTY,
    loading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
