'use client';

import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/authContext';

// Drop the whole cache when the signed-in user changes so a switched-in user
// never sees the previous user's cached data. Boot (null → first id) is not a
// switch — data fetched while auth resolves belongs to that first user.
function UserCacheBoundary() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id ?? null;
  const prevIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const prev = prevIdRef.current;
    if (prev !== undefined && prev !== null && prev !== userId) {
      queryClient.clear();
    }
    prevIdRef.current = userId;
  }, [userId, queryClient]);
  return null;
}

// Defaults tuned for a Capacitor-wrapped daily driver on flaky property wifi:
// - staleTime 30s: remounts within 30s paint from cache with no refetch at
//   all; older data still paints instantly, then refreshes in the background.
// - gcTime 30min: cache survives long detours (e.g. a while in /messages).
// - refetchOnWindowFocus/Reconnect: data freshens when the app foregrounds
//   or wifi comes back.
// - retry 2 with backoff: absorbs blips without minute-long spinners.
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 30 * 60_000,
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
            retry: 2,
            retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 15_000),
          },
          mutations: { retry: 0 },
        },
      })
  );
  return (
    <QueryClientProvider client={client}>
      <UserCacheBoundary />
      {children}
    </QueryClientProvider>
  );
}
