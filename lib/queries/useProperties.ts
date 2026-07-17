'use client';

import { useQuery } from '@tanstack/react-query';
import type { PropertyOption } from '@/lib/types';
import { qk } from './keys';
import { fetchJson } from './fetchJson';

const EMPTY: PropertyOption[] = [];

export async function fetchProperties(): Promise<PropertyOption[]> {
  const json = await fetchJson<{ properties?: PropertyOption[] }>('/api/properties');
  return json.properties ?? [];
}

// Shared, cached property list (active properties only — the bare endpoint
// default). One fetch feeds every surface; remounts paint from cache.
export function useProperties({ enabled = true }: { enabled?: boolean } = {}) {
  const query = useQuery({
    queryKey: qk.properties,
    queryFn: fetchProperties,
    enabled,
  });
  return {
    properties: query.data ?? EMPTY,
    loading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
