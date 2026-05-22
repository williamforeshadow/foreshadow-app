'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { TopBar } from './TopBar';
import { AiChatPanel } from './ai-chat/AiChatPanel';

// App-wide chrome: the universal top bar and the AI chat panel, rendered
// once around every page. The login route renders bare (no chrome). The
// chat panel stays mounted across route changes so the conversation
// persists; it is position:fixed, so its placement in the tree is moot.
export function AppChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (pathname === '/login') {
    return <>{children}</>;
  }

  return (
    <>
      <div className="flex h-dvh flex-col">
        <TopBar />
        <div className="relative min-h-0 flex-1">{children}</div>
      </div>
      <AiChatPanel />
    </>
  );
}
