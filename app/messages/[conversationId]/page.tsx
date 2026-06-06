'use client';

import { useParams } from 'next/navigation';
import MobileRouteShell from '@/components/mobile/MobileRouteShell';
import { useIsMobile } from '@/lib/useIsMobile';
import { useMessages } from '@/components/messages/MessagesProvider';
import { ConversationThread } from '@/components/messages/ConversationThread';

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

  return <ConversationThread conversation={conversation} loading={loading} />;
}
