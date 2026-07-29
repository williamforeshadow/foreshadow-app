'use client';

import { Suspense, type ReactNode } from 'react';
import Sidebar from '@/components/Sidebar';

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
// The <main> element reproduces the layout box pages used to get from
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
  return (
    <div className="flex h-screen overflow-hidden bg-[var(--app-shell-bg)]">
      {/* useSearchParams needs a Suspense boundary this high in the tree. */}
      <Suspense fallback={<div className="hidden h-full w-64 shrink-0 md:block" />}>
        <div className="hidden h-full shrink-0 md:block">
          <Sidebar />
        </div>
      </Suspense>
      {/* A plain div, not <main> — some routes (the Messages inbox) render
          their own <main> for the conversation pane, and nesting landmarks
          would leave the page with two. */}
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--app-shell-card)] md:m-[var(--app-shell-gap)] md:rounded-[var(--app-shell-radius)] md:border md:border-[var(--app-shell-card-border)]">
        {children}
      </div>
    </div>
  );
}
