'use client';

import { Suspense, useCallback, useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  attemptBack,
  canGoBack,
  commitNavigation,
  getNavIndex,
  installNavigationTracking,
} from '@/lib/navigationHistory';

// React bindings for lib/navigationHistory.ts (which owns the actual bookkeeping
// and explains the mechanism).
//
// ---- Mounting model -------------------------------------------------
//
// <NavigationHistoryTracker /> mounts once in app/layout.tsx, above the router,
// and renders nothing. It must sit ABOVE <AppChrome>, which early-returns bare
// children on /login, /update-password and /demo/* — a tracking gap on those
// routes would desynchronise the depth from the real history stack.
//
// ---- Why there's no context ------------------------------------------
//
// The depth lives in module state, not React state, and deliberately so: it
// describes the document's history rather than any component's lifecycle. A
// context would only wrap functions whose identity never changes, so it would
// buy nothing and add a provider that re-renders the whole tree on navigation.
// Consumers take useBackNavigation() instead, which needs nothing but the
// router.

/**
 * Reconciles the tracked depth with the entry the user is on, once per
 * committed navigation.
 *
 * Split into its own component behind <Suspense> because it reads
 * useSearchParams(): Next's static-prerender pipeline bails out on any
 * component that does, and /_not-found inherits the root layout. Same pattern
 * and same reason as TaskDeepLinkSync in lib/reservationViewerContext.tsx.
 */
function NavigationCommitSync() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams?.toString() ?? '';

  useEffect(() => {
    // Installing here rather than in a mount-only effect keeps the ordering
    // obvious: the wrapper is always in place before the first commit reconciles
    // against it. Both calls are idempotent.
    installNavigationTracking();
    commitNavigation();

    if (process.env.NODE_ENV !== 'production') {
      // Hand-verification hook. `__fsNav.index()` should track reality across
      // pushes, replaces, traversal and reload; `__fsNav.back(href)` exercises
      // the same path a back arrow takes, including the cold-entry fallback.
      (window as unknown as { __fsNav?: unknown }).__fsNav = {
        index: getNavIndex,
        canGoBack,
        back: (fallbackHref: string) =>
          attemptBack(() => {
            window.location.href = fallbackHref;
          }),
      };
    }
  }, [pathname, search]);

  return null;
}

export function NavigationHistoryTracker() {
  return (
    <Suspense fallback={null}>
      <NavigationCommitSync />
    </Suspense>
  );
}

/**
 * Returns `goBack(fallbackHref)` — pops in-app history when the user got here
 * from another screen, and navigates to `fallbackHref` when they didn't (a cold
 * entry from Slack, a push notification, or a bookmark).
 *
 * `fallbackHref` should stay whatever hard-coded parent the affordance used
 * before, so the deep-link case behaves exactly as it always has.
 */
export function useBackNavigation() {
  const router = useRouter();

  return useCallback(
    (fallbackHref: string) => {
      attemptBack(() => router.push(fallbackHref as never));
    },
    [router],
  );
}
