'use client';

import { usePathname } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import MobileRouteShell from '@/components/mobile/MobileRouteShell';
import { useIsMobile } from '@/lib/useIsMobile';

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
      </MobileRouteShell>
    );
  }

  return (
    <div className="flex h-screen bg-white dark:bg-neutral-900">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">{children}</div>
    </div>
  );
}
