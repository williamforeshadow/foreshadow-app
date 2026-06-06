'use client';

import DesktopSidebarShell from '@/components/DesktopSidebarShell';
import MobileRouteShell from '@/components/mobile/MobileRouteShell';
import { useIsMobile } from '@/lib/useIsMobile';
import { useMessageFeed } from '@/components/messages/useMessageFeed';
import { ConversationList } from '@/components/messages/ConversationList';

// /messages — guest-message inbox (v1). One row per conversation thread; tap to
// expand the full back-and-forth. Branches desktop/mobile like
// app/assignments/page.tsx.
export default function MessagesPage() {
  const isMobile = useIsMobile();
  const { conversations, loading } = useMessageFeed();

  if (isMobile === null) return null;

  if (isMobile) {
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
      <div className="mx-auto flex h-full w-full max-w-2xl flex-col px-4 py-6">
        <h1 className="px-3 pb-3 text-lg font-semibold text-neutral-900 dark:text-white">
          Messages
        </h1>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ConversationList conversations={conversations} loading={loading} />
        </div>
      </div>
    </DesktopSidebarShell>
  );
}
