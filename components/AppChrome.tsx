'use client';

import { Suspense, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { AiChatPanel } from './ai-chat/AiChatPanel';
import { AppShell } from './AppShell';
import { MobileBottomNav } from './mobile/MobileBottomNav';
import { MobileAgentChat } from './mobile/MobileAgentChat';
import { useIsMobile } from '@/lib/useIsMobile';
import { PushNotificationsBridge } from '@/lib/push/PushNotificationsBridge';

// Mounts the universal AI chat around every page (except /login). The chat is
// position:fixed, so its placement in the tree is moot — what matters is that
// it stays mounted across route changes so the conversation persists.
//
// Two surfaces share the AiChat context (open/close state): desktop gets the
// docked AiChatPanel; mobile gets the MobileAgentChat bottom sheet. Each is
// mounted only on its platform so they never both respond to `open()`.
export function AppChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isMobile = useIsMobile();

  // The public /demo/* marketing routes render their own (mocked) chrome and
  // must not mount the global agent panel / push bridge. /update-password is
  // reached from a signed-out email link, so it gets the same bare treatment
  // as /login rather than a sidebar it can't navigate with.
  if (
    pathname === '/login' ||
    pathname === '/update-password' ||
    pathname.startsWith('/demo')
  ) {
    return <>{children}</>;
  }

  return (
    <>
      <AppShell>{children}</AppShell>
      <Suspense fallback={null}>
        <MobileBottomNav />
      </Suspense>
      {isMobile === false && <AiChatPanel />}
      {isMobile === true && <MobileAgentChat />}
      <PushNotificationsBridge />
    </>
  );
}
