'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

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
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
