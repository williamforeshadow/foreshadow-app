'use client';

import { useCallback, useEffect, useState } from 'react';
import type { GuestMessageRecord } from '@/lib/messages';

/**
 * Guest-message inbox feed — fetch + poll. Ingestion is push (Hostaway webhook),
 * but the open page still polls the read API every 60s to pick up newly-arrived
 * rows, mirroring the notifications inbox (useNotificationFeed).
 */
export function useMessageFeed(pollMs = 60000) {
  const [messages, setMessages] = useState<GuestMessageRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/messages?limit=50', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setMessages(data.messages ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = window.setInterval(load, pollMs);
    return () => window.clearInterval(id);
  }, [load, pollMs]);

  return { messages, loading };
}
