'use client';

import React from 'react';

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
  const [property, setProperty] = React.useState<PropertyProfile | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const fetchProperty = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/properties/${propertyId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load property');
      setProperty(data.property as PropertyProfile);
    } catch (err: any) {
      setError(err.message || 'Failed to load property');
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  React.useEffect(() => {
    fetchProperty();
  }, [fetchProperty]);

  const applyLocalPatch = React.useCallback((patch: Partial<PropertyProfile>) => {
    setProperty((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const value: PropertyContextValue = {
    property,
    loading,
    error,
    refresh: fetchProperty,
    applyLocalPatch,
  };

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
