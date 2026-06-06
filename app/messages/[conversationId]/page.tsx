'use client';

import { useParams } from 'next/navigation';
import MobileRouteShell from '@/components/mobile/MobileRouteShell';
import { useIsMobile } from '@/lib/useIsMobile';
import { useMessages } from '@/components/messages/MessagesProvider';
import { ConversationThread } from '@/components/messages/ConversationThread';
import { ConversationDetailPanel } from '@/components/messages/ConversationDetailPanel';

// /messages/[conversationId] — the selected conversation. Reads the shared
// conversations from context (fetched once in the layout). Desktop renders bare
// into the layout's right pane; mobile wraps in its own full-screen shell.
export default function ConversationPage() {
  const params = useParams();
  const isMobile = useIsMobile();
  const { conversations, loading } = useMessages();

  const raw = params?.conversationId;
  const id = Array.isArray(raw) ? raw[0] : raw;
  const conversationId = id ? decodeURIComponent(id) : '';
  const conversation = conversations.find(
    (c) => c.conversation_id === conversationId,
  );

  if (isMobile === null) return null;

  if (isMobile) {
    return (
      <MobileRouteShell
        backHref="/messages"
        title={conversation?.guest_name ?? 'Conversation'}
      >
        <ConversationThread
          conversation={conversation}
          loading={loading}
          showHeader={false}
        />
      </MobileRouteShell>
    );
  }

  // Desktop: conversation thread fills the center, reservation context panel on
  // the right.
  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1">
        <ConversationThread conversation={conversation} loading={loading} />
      </div>
      <aside className="hidden w-80 shrink-0 border-l border-[var(--surface-elevated-divider)] lg:block">
        <ConversationDetailPanel conversation={conversation} />
      </aside>
    </div>
  );
}
