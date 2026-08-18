'use client';

import { useSelectedLayoutSegment } from 'next/navigation';
import { useIsMobile } from '@/lib/useIsMobile';
import { MessagesProvider, useMessages } from '@/components/messages/MessagesProvider';
import { ConversationList } from '@/components/messages/ConversationList';
import {
  ConversationHeaderActions,
  ConversationSearchField,
} from '@/components/messages/ConversationControls';
import { ConversationTabs } from '@/components/messages/ConversationTabs';
import { WindowHeader } from '@/components/ui/window-header';

// Master-detail chrome for /messages. The conversation list + its tabs/filters/
// sort live here (state in MessagesProvider) so they persist while the selected
// conversation (the child route) changes.
// The list column's control row: tabs on the left, the search / sort / filter
// affordances pushed right. The search FIELD is not here — it renders below
// the header band (see the aside), because it is collapsible and putting it
// inline would make the band's height depend on whether search is open. The
// band has to stay exactly 115px to line up with the conversation header
// beside it and with every other page in the app.
function ListControls() {
  const { tab, setTab } = useMessages();
  return (
    <>
      <ConversationTabs tab={tab} onChange={setTab} />
      <div className="ml-auto shrink-0">
        <ConversationHeaderActions />
      </div>
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
    // Tab-root page owning its own chrome — same header grammar as
    // My Assignments / Tasks / Schedule: title + fine print + toolbar in one
    // gradient block, capped with a hairline. The search / sort / filter
    // cluster renders ONCE, on the toolbar row beside the tabs.
    return (
      <div className="h-dvh flex flex-col overflow-hidden bg-white dark:bg-card">
        <div className="flex-shrink-0 bg-white dark:bg-card bg-[linear-gradient(to_bottom,var(--header-scrim),transparent)] border-b border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)]">
          <div
            className="px-[22px] pb-1"
            style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)' }}
          >
            <h1 className="text-[20px] font-semibold tracking-tight leading-tight text-neutral-900 dark:text-[#f0efed] truncate">
              Messages
            </h1>
          </div>
          <div className="px-[22px] pb-2">
            <div className="flex items-center gap-3 text-[11px] text-neutral-500 dark:text-[#66645f] uppercase tracking-[0.04em] font-medium">
              <span>Guest conversations</span>
            </div>
          </div>
          <div className="px-[22px] pb-1.5 flex items-center">
            <ListControls />
          </div>
          {/* Collapsed to nothing until the search affordance is toggled. */}
          <ConversationSearchField />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto hide-scrollbar pb-mobile-nav">
          <ListBody activeId={null} />
        </div>
      </div>
    );
  }

  return (
    <>
      {/* One flush surface (no floating panes) matching the rest of the app —
          columns are separated by hairline dividers, not gaps. `relative` so the
          conversation page's task-editor panel anchors here, spanning the full
          content row (list + conversation). */}
      <div className="relative flex h-full min-h-0">
        <aside className="msg-divider flex w-80 shrink-0 flex-col overflow-hidden border-r">
          <WindowHeader title="Messages" inset="column">
            <ListControls />
          </WindowHeader>
          {/* Collapsed to nothing until the search affordance is toggled, so
              it costs no height in the default state. */}
          <ConversationSearchField />
          <div className="min-h-0 flex-1 overflow-y-auto overlay-scrollbar">
            <ListBody activeId={activeId} />
          </div>
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </>
  );
}

export default function MessagesLayout({ children }: { children: React.ReactNode }) {
  return (
    <MessagesProvider>
      <MessagesChrome>{children}</MessagesChrome>
    </MessagesProvider>
  );
}
