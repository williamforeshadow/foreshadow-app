'use client';

import DesktopSidebarShell from '@/components/DesktopSidebarShell';
import MobileRouteShell from '@/components/mobile/MobileRouteShell';
import { useIsMobile } from '@/lib/useIsMobile';
import { useMessageFeed } from '@/components/messages/useMessageFeed';
import { MessageList } from '@/components/messages/MessageList';

// /messages — guest-message inbox (v1). Read-only list of guest<->host messages
// ingested from Hostaway. Branches desktop/mobile like app/assignments/page.tsx.
export default function MessagesPage() {
  const isMobile = useIsMobile();
  const { messages, loading } = useMessageFeed();

  if (isMobile === null) return null;

  if (isMobile) {
    return (
      <MobileRouteShell backHref="/" title="Messages">
        <div className="min-h-0 flex-1 overflow-y-auto hide-scrollbar">
          <MessageList messages={messages} loading={loading} />
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
          <MessageList messages={messages} loading={loading} />
        </div>
      </div>
    </DesktopSidebarShell>
  );
}
