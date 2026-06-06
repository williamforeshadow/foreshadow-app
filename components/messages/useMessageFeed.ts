'use client';

import { useCallback, useEffect, useState } from 'react';
import type { GuestConversation } from '@/lib/messages';

/**
 * Guest-message inbox feed — fetch + poll. Ingestion is push (Hostaway webhook),
 * but the open page polls the read API every 60s to pick up newly-arrived
 * conversations/messages, mirroring the notifications inbox (useNotificationFeed).
 */
export function useMessageFeed(pollMs = 60000) {
  const [conversations, setConversations] = useState<GuestConversation[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/messages', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setConversations(data.conversations ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = window.setInterval(load, pollMs);
    return () => window.clearInterval(id);
  }, [load, pollMs]);

  return { conversations, loading };
}
