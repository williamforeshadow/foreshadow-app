'use client';

import { useSelectedLayoutSegment } from 'next/navigation';
import DesktopSidebarShell from '@/components/DesktopSidebarShell';
import MobileRouteShell from '@/components/mobile/MobileRouteShell';
import { useIsMobile } from '@/lib/useIsMobile';
import { MessagesProvider, useMessages } from '@/components/messages/MessagesProvider';
import { ConversationList } from '@/components/messages/ConversationList';
import { ConversationListControls } from '@/components/messages/ConversationListControls';
import { ConversationTabs } from '@/components/messages/ConversationTabs';
import { ConversationFilterBar } from '@/components/messages/ConversationFilterBar';

// Master-detail chrome for /messages. The conversation list + its tabs/filters/
// sort live here (state in MessagesProvider) so they persist while the selected
// conversation (the child route) changes.
function ListControls() {
  const {
    tab,
    setTab,
    counts,
    query,
    setQuery,
    sort,
    toggleSort,
  } = useMessages();
  return (
    <>
      <ConversationListControls
        query={query}
        onQueryChange={setQuery}
        sort={sort}
        onToggleSort={toggleSort}
      />
      <ConversationFilterBar />
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
        <aside className="flex w-80 shrink-0 flex-col border-r border-[var(--surface-elevated-divider)]">
          <h1 className="shrink-0 px-3 pb-1 pt-3 text-lg font-semibold text-neutral-900 dark:text-white">
            Messages
          </h1>
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
