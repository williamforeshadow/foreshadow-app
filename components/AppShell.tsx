'use client';

import { Suspense, useCallback, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import Sidebar from '@/components/Sidebar';

// Full-screen is a preference, not view state — it survives reloads and
// navigation the same way the theme does.
const FULLSCREEN_STORAGE_KEY = 'foreshadow.appFullscreen';

// localStorage read through useSyncExternalStore rather than an effect that
// calls setState. The server (and the hydration pass) sees `false` via
// getServerSnapshot, the client reads the stored value, and React reconciles
// the difference itself — no hydration mismatch and no cascading render.
let cachedFullscreen: boolean | null = null;
const fullscreenListeners = new Set<() => void>();

function readFullscreen(): boolean {
  if (cachedFullscreen === null) {
    try {
      cachedFullscreen = window.localStorage.getItem(FULLSCREEN_STORAGE_KEY) === 'true';
    } catch {
      // Private mode / storage disabled — fall back to windowed.
      cachedFullscreen = false;
    }
  }
  return cachedFullscreen;
}

function subscribeFullscreen(onChange: () => void): () => void {
  fullscreenListeners.add(onChange);
  return () => {
    fullscreenListeners.delete(onChange);
  };
}

function setFullscreen(next: boolean): void {
  cachedFullscreen = next;
  try {
    window.localStorage.setItem(FULLSCREEN_STORAGE_KEY, String(next));
  } catch {
    // Preference just won't persist; the toggle still works this session.
  }
  fullscreenListeners.forEach((notify) => notify());
}

// The app window: sidebar on the left, routed page on the right.
//
// This mounts ABOVE the router (see AppChrome), which is the whole point —
// the sidebar renders once for the life of the session and survives every
// navigation. Previously each page wrapped itself in DesktopSidebarShell, so
// the sidebar was torn down and rebuilt on every route change; that flashed
// and reset its scroll position, and it made the "sidebar as permanent
// backdrop" reading below impossible.
//
// The backdrop is the SAME tone as the sidebar (--app-shell-bg), so there is
// no seam between them: the sidebar isn't a panel sitting on a page, it IS
// the window, and the routed content is a card floating on top of it. The
// backdrop shows through as a thin margin on the card's other three sides,
// which is what makes it read as one continuous surface underneath rather
// than a column beside.
//
// The card paints --app-shell-card rather than --background because in light
// mode --background is a grey; pages that don't paint their own surface (the
// Messages inbox, the concierge pages, the assignments list) would inherit it
// and land a shade off the pages that do paint white.
//
// The card reproduces the layout box pages used to get from
// DesktopSidebarShell — a definite height, flex column, clipped — so page
// internals (sticky headers, absolutely-positioned windows) behave as they
// did before. overflow-hidden does double duty: it clips children to the
// rounded corners AND preserves the old scroll containment.
//
// Mobile is handled in CSS rather than with useIsMobile: below `md` the
// sidebar is display:none and the card flattens to full-bleed. Branching on
// the hook would mean rendering `children` at a different tree position
// before and after the viewport resolves, remounting the entire app one
// frame in — and would flash a 256px sidebar on phones. The `md` breakpoint
// is 768px, the same line MOBILE_BREAKPOINT draws.
export function AppShell({ children }: { children: ReactNode }) {
  const isFullscreen = useSyncExternalStore(
    subscribeFullscreen,
    readFullscreen,
    () => false,
  );

  // The class goes on <html>, not on a wrapper here, because the thing that
  // needs it most is OUTSIDE this tree: the full-screen agent panel is
  // position:fixed and aligns off --app-sidebar-width. Overriding the
  // variables at the document root moves the panel and the card together.
  useEffect(() => {
    document.documentElement.classList.toggle('app-fullscreen', isFullscreen);
  }, [isFullscreen]);

  const toggleFullscreen = useCallback(() => {
    setFullscreen(!readFullscreen());
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--app-shell-bg)]">
      {/* useSearchParams needs a Suspense boundary this high in the tree. */}
      <Suspense fallback={<div data-app-sidebar className="hidden h-full w-64 shrink-0 md:block" />}>
        <div data-app-sidebar className="hidden h-full shrink-0 md:block">
          <Sidebar />
        </div>
      </Suspense>
      {/* A plain div, not <main> — some routes (the Messages inbox) render
          their own <main> for the conversation pane, and nesting landmarks
          would leave the page with two. */}
      <div
        data-app-card
        className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--app-shell-card)] md:m-[var(--app-shell-gap)] md:rounded-[var(--app-shell-radius)] md:border md:border-[var(--app-shell-card-border)]"
      >
        {children}

        {/* Lives here rather than in each page's header so every route gets
            it from one place — and so it is guaranteed present in full
            screen, where it is the only way back. Pinned to the card's top
            right, which is empty on every workspace header (their titles are
            left-aligned). Above page content on z-index for the same reason:
            if it can be covered, someone gets stranded in full screen. */}
        <button
          type="button"
          onClick={toggleFullscreen}
          aria-pressed={isFullscreen}
          aria-label={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
          title={isFullscreen ? 'Exit full screen' : 'Full screen'}
          className="absolute right-2 top-2 z-[60] hidden h-7 w-7 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-[rgba(30,25,20,0.06)] hover:text-neutral-700 md:inline-flex dark:text-[#66645f] dark:hover:bg-[rgba(255,255,255,0.07)] dark:hover:text-[#e8e7e3]"
        >
          {isFullscreen ? (
            <Minimize2 className="h-4 w-4" />
          ) : (
            <Maximize2 className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
}
