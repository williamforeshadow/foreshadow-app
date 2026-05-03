'use client';

import Sidebar from '@/components/Sidebar';
import { SidebarToggleButton } from '@/components/SidebarToggleButton';
import MobileRouteShell from '@/components/mobile/MobileRouteShell';
import { useIsMobile } from '@/lib/useIsMobile';

// Chrome wrapper for the dedicated /tasks/[id] route.
//
// Mirrors app/properties/layout.tsx so a deep-linked task gets the same
// app navigation everywhere else in the product has — sidebar + topbar on
// desktop, MobileRouteShell with a back arrow on mobile. The point is
// that landing here from Slack (or any external link) drops the user
// inside the app, not on a one-off detached page; they can navigate to
// any other surface afterward without bouncing through the dashboard.
//
// We deliberately do NOT mount ContextTaskDetailOverlay /
// ReservationDetailOverlay here — the page IS the task detail, and any
// in-page references that need to surface OTHER tasks navigate to a
// fresh /tasks/<other-id> route rather than stacking overlays. Keeping
// this layout overlay-free also avoids the potential confusion of an
// overlay stacking on top of the same task it depicts.
//
// `isMobile === null` early-return is the same flicker-avoidance pattern
// PropertiesLayout uses: useIsMobile is unresolved until the media query
// fires post-hydration, so we render nothing for one frame to avoid
// flashing the desktop chrome on a mobile device. The cost is that the
// SSR HTML for /tasks/[id] doesn't carry the rendered task body — only
// the meta + outer shell. The page IS still better than the legacy
// /?view=tasks&task=<uuid> form because the client bundle to hydrate is
// just this route (not the entire dashboard SPA), and the canonical
// /tasks/<uuid> path round-trips through auth more reliably than a
// query-string-based deep link does on Slack mobile webviews. Pure SSR
// without the null-phase bailout is a worthwhile follow-up if mobile
// loads still feel slow after this lands.
export default function TaskDetailLayout({
  children,
}: { children: React.ReactNode }) {
  const isMobile = useIsMobile();

  if (isMobile === null) {
    return null;
  }

  if (isMobile) {
    return (
      <MobileRouteShell backHref="/tasks">{children}</MobileRouteShell>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-neutral-900">
      {/* Thin top bar — gives the sidebar toggle a fixed home above the
          sidebar + page body, matching every other page in the app. */}
      <div className="flex-shrink-0 px-3 py-2 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800">
        <SidebarToggleButton />
      </div>

      {/* Body: sidebar + page content. `relative` is preserved here only
          for parity with PropertiesLayout — the dedicated task page
          itself doesn't render any absolute-positioned children. */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden relative">
          {children}
        </div>
      </div>
    </div>
  );
}
