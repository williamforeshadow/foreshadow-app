'use client';

import { useSelectedLayoutSegment } from 'next/navigation';
import DesktopSidebarShell from '@/components/DesktopSidebarShell';
import MobileRouteShell from '@/components/mobile/MobileRouteShell';
import { useIsMobile } from '@/lib/useIsMobile';
import { MessagesProvider, useMessages } from '@/components/messages/MessagesProvider';
import { ConversationList } from '@/components/messages/ConversationList';

// Master-detail chrome for /messages. The conversation list lives here so it
// stays mounted while the selected conversation (the child route) changes — no
// reload or flash on selection. Desktop = two panes side by side; mobile = the
// list when no conversation is open, otherwise the child detail full-screen.
function MessagesChrome({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();
  const segment = useSelectedLayoutSegment(); // null on /messages, the id on detail
  const activeId = segment ? decodeURIComponent(segment) : null;
  const { conversations, loading } = useMessages();

  if (isMobile === null) return null;

  if (isMobile) {
    // Detail open → let the child page render its own full-screen shell.
    if (segment !== null) return <>{children}</>;
    // Index → the list is the screen.
    return (
      <MobileRouteShell backHref="/" title="Messages">
        <div className="min-h-0 flex-1 overflow-y-auto hide-scrollbar">
          <ConversationList conversations={conversations} loading={loading} />
        </div>
      </MobileRouteShell>
    );
  }

  return (
    <DesktopSidebarShell>
      <div className="flex h-full">
        <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-r border-[var(--surface-elevated-divider)]">
          <h1 className="shrink-0 px-3 py-3 text-lg font-semibold text-neutral-900 dark:text-white">
            Messages
          </h1>
          <ConversationList
            conversations={conversations}
            loading={loading}
            activeId={activeId}
          />
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </DesktopSidebarShell>
  );
}

export default function MessagesLayout({ children }: { children: React.ReactNode }) {
  return (
    <MessagesProvider>
      <MessagesChrome>{children}</MessagesChrome>
    </MessagesProvider>
  );
}
