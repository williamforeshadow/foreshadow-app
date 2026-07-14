'use client';

import { Suspense, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { AiChatPanel } from './ai-chat/AiChatPanel';
import { MobileBottomNav } from './mobile/MobileBottomNav';
import { PushNotificationsBridge } from '@/lib/push/PushNotificationsBridge';

// Mounts the universal AI chat panel around every page (except /login).
// The panel is position:fixed, so its placement in the tree is moot — what
// matters is that it stays mounted across route changes so the conversation
// persists.
export function AppChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // The public /demo/* marketing routes render their own (mocked) chrome and
  // must not mount the global agent panel / push bridge.
  if (pathname === '/login' || pathname.startsWith('/demo')) {
    return <>{children}</>;
  }

  return (
    <>
      {children}
      <Suspense fallback={null}>
        <MobileBottomNav />
      </Suspense>
      <AiChatPanel />
      <PushNotificationsBridge />
    </>
  );
}
