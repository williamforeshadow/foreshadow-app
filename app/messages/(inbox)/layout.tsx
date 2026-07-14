'use client';

import { useSelectedLayoutSegment } from 'next/navigation';
import DesktopSidebarShell from '@/components/DesktopSidebarShell';
import MobileRouteShell from '@/components/mobile/MobileRouteShell';
import { useIsMobile } from '@/lib/useIsMobile';
import { MessagesProvider, useMessages } from '@/components/messages/MessagesProvider';
import { ConversationList } from '@/components/messages/ConversationList';
import {
  ConversationHeaderActions,
  ConversationSearchField,
} from '@/components/messages/ConversationControls';
import { ConversationTabs } from '@/components/messages/ConversationTabs';

// Master-detail chrome for /messages. The conversation list + its tabs/filters/
// sort live here (state in MessagesProvider) so they persist while the selected
// conversation (the child route) changes.
function ListControls() {
  const { tab, setTab } = useMessages();
  return (
    <>
      <ConversationSearchField />
      <ConversationTabs tab={tab} onChange={setTab} />
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
      <MobileRouteShell backHref="/" title="Messages" rightSlot={<ConversationHeaderActions />}>
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
      {/* `relative` so the conversation page's task-editor panel anchors here —
          spanning the full content row (list + conversation), making its w-1/3
          width match the detail sheet on Bins/Tasks rather than 1/3 of just the
          narrower conversation column. */}
      <div className="glass-bg-neutral relative flex h-full gap-2.5 p-2.5">
        <aside className="msg-pane flex w-80 shrink-0 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center justify-between gap-2 px-4 pb-2 pt-3.5">
            <h1 className="text-lg font-semibold tracking-tight text-foreground">
              Messages
            </h1>
            <ConversationHeaderActions />
          </div>
          <ListControls />
          <div className="min-h-0 flex-1 overflow-y-auto overlay-scrollbar">
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
