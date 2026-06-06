'use client';

import { createContext, useContext } from 'react';
import { useMessageFeed } from '@/components/messages/useMessageFeed';
import type { GuestConversation } from '@/lib/messages';

// Shares one polling fetch of conversations across the messages layout (left
// list) and the detail page (right pane), so selecting a conversation never
// refetches or flashes the list.
interface MessagesContextValue {
  conversations: GuestConversation[];
  loading: boolean;
}

const MessagesContext = createContext<MessagesContextValue | null>(null);

export function MessagesProvider({ children }: { children: React.ReactNode }) {
  const { conversations, loading } = useMessageFeed();
  return (
    <MessagesContext.Provider value={{ conversations, loading }}>
      {children}
    </MessagesContext.Provider>
  );
}

export function useMessages(): MessagesContextValue {
  const ctx = useContext(MessagesContext);
  if (!ctx) throw new Error('useMessages must be used within MessagesProvider');
  return ctx;
}
