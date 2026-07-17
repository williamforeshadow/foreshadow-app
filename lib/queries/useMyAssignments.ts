'use client';

import { useQuery } from '@tanstack/react-query';
import { qk } from './keys';
import { fetchJson } from './fetchJson';

// Shared, cached "my assignments" payload. The two consuming views declare
// their own Raw* row types (they render different subsets), so the hook is
// generic over the row shapes rather than owning them.
export function useMyAssignments<TTask = unknown, TProject = unknown>(
  userId: string | undefined
) {
  const query = useQuery({
    queryKey: qk.myAssignments(userId ?? ''),
    enabled: !!userId,
    queryFn: async () => {
      const json = await fetchJson<{ tasks?: TTask[]; projects?: TProject[] }>(
        `/api/my-assignments?user_id=${userId}`
      );
      return { tasks: json.tasks ?? [], projects: json.projects ?? [] };
    },
  });
  return {
    rawData: query.data ?? null,
    loading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
