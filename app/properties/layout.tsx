'use client';

import { usePathname } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import { SidebarToggleButton } from '@/components/SidebarToggleButton';
import MobileRouteShell from '@/components/mobile/MobileRouteShell';
import { useIsMobile } from '@/lib/useIsMobile';
import { ReservationDetailOverlay } from '@/components/reservations/ReservationDetailOverlay';
import { ContextTaskDetailOverlay } from '@/components/reservations/ContextTaskDetailOverlay';

export default function PropertiesLayout({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();
  const pathname = usePathname();

  if (isMobile === null) {
    return null;
  }

  if (isMobile) {
    // On the list root (/properties) show the hamburger; on detail routes
    // (/properties/[id], /properties/[id]/anything) show a back arrow
    // pointing to the list.
    const isDetail = !!pathname && /^\/properties\/[^/]+/.test(pathname);
    return (
      <MobileRouteShell backHref={isDetail ? '/properties' : undefined}>
        {children}
        {/* Reservation + context task overlays — mobile uses fixed inset-0
            so any anchor works. Mutually exclusive in the provider; both
            mount here so any /properties surface can swap into them. */}
        <ReservationDetailOverlay />
        <ContextTaskDetailOverlay />
      </MobileRouteShell>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-neutral-900">
      {/* Thin top bar — gives the sidebar toggle a fixed home above the
          sidebar + child header, matching every other page in the app. */}
      <div className="flex-shrink-0 px-3 py-2 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800">
        <SidebarToggleButton />
      </div>

      {/* Body: sidebar + child route content */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        {/* `relative` so descendants inside a detail tab (e.g. PropertyTasksView's
            right-side detail panel) can render as an absolute overlay that
            spans the property detail header. */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          {children}
          {/* Reservation + context task overlays — anchor to this `relative`
              column so they line up exactly with the property detail tabs'
              own `absolute right-0 w-1/3` overlays. Mutually exclusive in
              the provider; only one renders at a time. */}
          <ReservationDetailOverlay />
          <ContextTaskDetailOverlay />
        </div>
      </div>
    </div>
  );
}
