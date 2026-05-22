'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { AiChatPanel } from './ai-chat/AiChatPanel';

// Mounts the universal AI chat panel around every page (except /login).
// The panel is position:fixed, so its placement in the tree is moot — what
// matters is that it stays mounted across route changes so the conversation
// persists.
export function AppChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (pathname === '/login') {
    return <>{children}</>;
  }

  return (
    <>
      {children}
      <AiChatPanel />
    </>
  );
}
