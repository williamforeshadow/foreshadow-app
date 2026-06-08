'use client';

import Link from 'next/link';
import { GraduationCap } from 'lucide-react';
import { useSelectedLayoutSegment } from 'next/navigation';
import DesktopSidebarShell from '@/components/DesktopSidebarShell';
import MobileRouteShell from '@/components/mobile/MobileRouteShell';
import { useIsMobile } from '@/lib/useIsMobile';
import { MessagesProvider, useMessages } from '@/components/messages/MessagesProvider';
import { ConversationList } from '@/components/messages/ConversationList';
import { ConversationControls } from '@/components/messages/ConversationControls';
import { ConversationTabs } from '@/components/messages/ConversationTabs';

// Master-detail chrome for /messages. The conversation list + its tabs/filters/
// sort live here (state in MessagesProvider) so they persist while the selected
// conversation (the child route) changes.
function ListControls() {
  const { tab, setTab, counts } = useMessages();
  return (
    <>
      <ConversationControls />
      <ConversationTabs tab={tab} onChange={setTab} counts={counts} />
    </>
  );
}

function ListBody({ activeId }: { activeId: string | null }) {
  const { visible, loading, query, activeFilterCount } = useMessages();
  const filtered = query.trim() || activeFilterCount > 0;
  return (
    <ConversationList
      conversations={visible}
      loading={loading}
      activeId={activeId}
      emptyLabel={filtered ? 'No matching conversations' : 'No messages yet'}
    />
  );
}

function MessagesChrome({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();
  const segment = useSelectedLayoutSegment(); // null on /messages, the id on detail
  const activeId = segment ? decodeURIComponent(segment) : null;

  if (isMobile === null) return null;

  if (isMobile) {
    if (segment !== null) return <>{children}</>;
    return (
      <MobileRouteShell backHref="/" title="Messages">
        <div className="flex h-full min-h-0 flex-col">
          <ListControls />
          <div className="min-h-0 flex-1 overflow-y-auto hide-scrollbar">
            <ListBody activeId={null} />
          </div>
        </div>
      </MobileRouteShell>
    );
  }

  return (
    <DesktopSidebarShell>
      <div className="flex h-full">
        <aside className="flex w-80 shrink-0 flex-col border-r border-[var(--surface-elevated-divider)] bg-[var(--surface-elevated)]">
          <div className="flex shrink-0 items-center justify-between px-3 pb-3 pt-3.5">
            <h1 className="text-lg font-semibold tracking-tight text-foreground">
              Messages
            </h1>
            <Link
              href="/messages/concierge-training"
              title="Concierge Training"
              aria-label="Concierge Training"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <GraduationCap className="h-4 w-4" aria-hidden />
            </Link>
          </div>
          <ListControls />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ListBody activeId={activeId} />
          </div>
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
