'use client';

import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationRecord } from '@/lib/notifications';
import { qk } from '@/lib/queries/keys';
import { fetchJson } from '@/lib/queries/fetchJson';

export type NotificationView = 'unread' | 'all';

const EMPTY: NotificationRecord[] = [];

type FeedData = { notifications: NotificationRecord[]; unreadCount: number };

async function fetchFeed(view: NotificationView): Promise<FeedData> {
  const data = await fetchJson<{ notifications?: NotificationRecord[]; unread_count?: number }>(
    `/api/notifications?view=${view}&limit=50`
  );
  return { notifications: data.notifications ?? [], unreadCount: data.unread_count ?? 0 };
}

/**
 * Shared notification feed state — fetch + poll + mark-read — used by both the
 * desktop dropdown (NotificationBell) and the mobile notifications page. Data
 * lives in the shared React Query cache, so the two surfaces share one fetch
 * and one poll instead of polling independently.
 */
export function useNotificationFeed(opts?: {
  pollMs?: number;
  initialView?: NotificationView;
}) {
  const pollMs = opts?.pollMs ?? 60000;
  const [view, setView] = useState<NotificationView>(opts?.initialView ?? 'unread');
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: qk.notifications(view),
    queryFn: () => fetchFeed(view),
    refetchInterval: pollMs,
  });

  const markRead = useCallback(
    async (ids: string[] | 'all') => {
      await fetch('/api/notifications/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ids === 'all' ? { all: true } : { ids }),
      });
      // Both views change: read items leave 'unread' and flip state in 'all'.
      await queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    [queryClient],
  );

  return {
    view,
    setView,
    notifications: query.data?.notifications ?? EMPTY,
    unreadCount: query.data?.unreadCount ?? 0,
    loading: query.isLoading,
    markRead,
  };
}
