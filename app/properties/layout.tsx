'use client';

import { usePathname } from 'next/navigation';
import DesktopSidebarShell from '@/components/DesktopSidebarShell';
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
    const isDetail = !!pathname && /^\/properties\/[^/]+/.test(pathname);
    return (
      <MobileRouteShell backHref={isDetail ? '/properties' : undefined}>
        {children}
        <ReservationDetailOverlay />
        <ContextTaskDetailOverlay />
      </MobileRouteShell>
    );
  }

  return (
    <DesktopSidebarShell>
      {children}
      <ReservationDetailOverlay />
      <ContextTaskDetailOverlay />
    </DesktopSidebarShell>
  );
}
