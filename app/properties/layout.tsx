'use client';

import { useIsMobile } from '@/lib/useIsMobile';
import { ReservationDetailOverlay } from '@/components/reservations/ReservationDetailOverlay';
import { ContextTaskDetailOverlay } from '@/components/reservations/ContextTaskDetailOverlay';

export default function PropertiesLayout({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();

  if (isMobile === null) {
    return null;
  }

  if (isMobile) {
    // Bare mobile frame — no top bar. The list page and PropertyShell each
    // render the standard page header themselves (title beside the back
    // chevron), matching the My Assignments / Tasks / Schedule grammar.
    return (
      <div className="h-dvh bg-white dark:bg-card overflow-hidden flex flex-col safe-area-top">
        <main className="flex-1 min-h-0 overflow-hidden">{children}</main>
        <ReservationDetailOverlay />
        <ContextTaskDetailOverlay />
      </div>
    );
  }

  return (
    <>
      {children}
      <ReservationDetailOverlay />
      <ContextTaskDetailOverlay />
    </>
  );
}
