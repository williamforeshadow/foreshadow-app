'use client';

import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/queries/keys';
import { fetchJson } from '@/lib/queries/fetchJson';

// Canonical property profile shape used across all detail tabs. Kept in
// one place so tabs and the shell share one source of truth.
export interface PropertyProfile {
  id: string;
  name: string;
  hostaway_name: string | null;
  hostaway_listing_id: number | null;
  is_active: boolean;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  address_country: string | null;
  latitude: number | null;
  longitude: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  timezone: string | null;
  created_at: string;
  updated_at: string;
}

interface PropertyContextValue {
  property: PropertyProfile | null;
  loading: boolean;
  error: string | null;
  // Triggers a re-fetch from the API. Called by tabs after mutations that
  // modify the property row itself (rename, active toggle, link/unlink).
  refresh: () => Promise<void>;
  // Locally patches the cached property without re-fetching — useful when
  // a tab already has the authoritative row back from an API response.
  applyLocalPatch: (patch: Partial<PropertyProfile>) => void;
}

const Context = React.createContext<PropertyContextValue | null>(null);

export function usePropertyContext(): PropertyContextValue {
  const ctx = React.useContext(Context);
  if (!ctx) {
    throw new Error('usePropertyContext must be used inside <PropertyProvider>');
  }
  return ctx;
}

// Convenience: throws if property hasn't loaded yet. Tabs that render
// only after the shell's loading gate can use this to avoid null checks.
export function useProperty(): PropertyProfile {
  const { property } = usePropertyContext();
  if (!property) {
    throw new Error('Property not loaded — render inside <PropertyProvider> past its loading gate.');
  }
  return property;
}

export function PropertyProvider({
  propertyId,
  children,
}: {
  propertyId: string;
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: qk.property(propertyId),
    queryFn: () =>
      fetchJson<{ property: PropertyProfile }>(`/api/properties/${propertyId}`).then(
        (d) => d.property
      ),
  });
  const { refetch } = query;

  const refresh = React.useCallback(async () => {
    await refetch();
  }, [refetch]);

  const applyLocalPatch = React.useCallback(
    (patch: Partial<PropertyProfile>) => {
      queryClient.cancelQueries({ queryKey: qk.property(propertyId), exact: true });
      queryClient.setQueryData<PropertyProfile>(qk.property(propertyId), (prev) =>
        prev ? { ...prev, ...patch } : prev
      );
    },
    [queryClient, propertyId]
  );

  const value: PropertyContextValue = {
    property: query.data ?? null,
    loading: query.isLoading,
    error: query.error ? query.error.message || 'Failed to load property' : null,
    refresh,
    applyLocalPatch,
  };

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
