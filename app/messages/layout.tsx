'use client';

import { useMemo, useState } from 'react';
import { useSelectedLayoutSegment } from 'next/navigation';
import DesktopSidebarShell from '@/components/DesktopSidebarShell';
import MobileRouteShell from '@/components/mobile/MobileRouteShell';
import { useIsMobile } from '@/lib/useIsMobile';
import { MessagesProvider, useMessages } from '@/components/messages/MessagesProvider';
import { ConversationList } from '@/components/messages/ConversationList';
import {
  ConversationListControls,
  type ConversationSort,
} from '@/components/messages/ConversationListControls';

// Master-detail chrome for /messages. The conversation list lives here so it
// stays mounted while the selected conversation (the child route) changes — no
// reload or flash on selection. Desktop = two panes side by side; mobile = the
// list when no conversation is open, otherwise the child detail full-screen.
function MessagesChrome({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();
  const segment = useSelectedLayoutSegment(); // null on /messages, the id on detail
  const activeId = segment ? decodeURIComponent(segment) : null;
  const { conversations, loading } = useMessages();

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<ConversationSort>('newest');

  // Filter by guest name + sort by last activity (client-side; list is loaded).
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? conversations.filter((c) =>
          (c.guest_name ?? '').toLowerCase().includes(q),
        )
      : conversations;
    return [...filtered].sort((a, b) => {
      const cmp = (a.last_message_at ?? '').localeCompare(b.last_message_at ?? '');
      return sort === 'newest' ? -cmp : cmp;
    });
  }, [conversations, query, sort]);

  const toggleSort = () =>
    setSort((s) => (s === 'newest' ? 'oldest' : 'newest'));

  if (isMobile === null) return null;

  if (isMobile) {
    // Detail open → let the child page render its own full-screen shell.
    if (segment !== null) return <>{children}</>;
    // Index → the list is the screen.
    return (
      <MobileRouteShell backHref="/" title="Messages">
        <div className="flex h-full min-h-0 flex-col">
          <ConversationListControls
            query={query}
            onQueryChange={setQuery}
            sort={sort}
            onToggleSort={toggleSort}
          />
          <div className="min-h-0 flex-1 overflow-y-auto hide-scrollbar">
            <ConversationList
              conversations={visible}
              loading={loading}
              emptyLabel={query.trim() ? 'No matching guests' : 'No messages yet'}
            />
          </div>
        </div>
      </MobileRouteShell>
    );
  }

  return (
    <DesktopSidebarShell>
      <div className="flex h-full">
        <aside className="flex w-80 shrink-0 flex-col border-r border-[var(--surface-elevated-divider)]">
          <h1 className="shrink-0 px-3 pb-2 pt-3 text-lg font-semibold text-neutral-900 dark:text-white">
            Messages
          </h1>
          <ConversationListControls
            query={query}
            onQueryChange={setQuery}
            sort={sort}
            onToggleSort={toggleSort}
          />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ConversationList
              conversations={visible}
              loading={loading}
              activeId={activeId}
              emptyLabel={query.trim() ? 'No matching guests' : 'No messages yet'}
            />
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
