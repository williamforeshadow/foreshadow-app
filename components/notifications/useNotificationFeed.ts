'use client';

import { useCallback, useEffect, useState } from 'react';
import type { NotificationRecord } from '@/lib/notifications';

export type NotificationView = 'unread' | 'all';

/**
 * Shared notification feed state — fetch + poll + mark-read — used by both the
 * desktop dropdown (NotificationBell) and the mobile notifications page so the
 * two surfaces stay in lockstep. A single effect loads the active view and
 * polls it; changing the view reloads immediately.
 */
export function useNotificationFeed(opts?: {
  pollMs?: number;
  initialView?: NotificationView;
}) {
  const pollMs = opts?.pollMs ?? 60000;
  const [view, setView] = useState<NotificationView>(opts?.initialView ?? 'unread');
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (mode: NotificationView) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/notifications?view=${mode}&limit=50`, {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(data.notifications ?? []);
      setUnreadCount(data.unread_count ?? 0);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load the active view on mount + whenever it changes, and poll it in the
  // background. The poll interval is re-created on view change, which is fine.
  useEffect(() => {
    load(view);
    const id = window.setInterval(() => load(view), pollMs);
    return () => window.clearInterval(id);
  }, [load, view, pollMs]);

  const markRead = useCallback(
    async (ids: string[] | 'all') => {
      await fetch('/api/notifications/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ids === 'all' ? { all: true } : { ids }),
      });
      await load(view);
    },
    [load, view],
  );

  return { view, setView, notifications, unreadCount, loading, markRead };
}
