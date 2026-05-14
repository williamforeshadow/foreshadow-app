'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { UserAvatar } from '@/components/ui/user-avatar';
import { formatRelative } from '@/src/lib/dates';
import type { NotificationRecord } from '@/lib/notifications';

type ViewMode = 'unread' | 'all';

export function NotificationBell({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<ViewMode>('unread');
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (mode: ViewMode = view) => {
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
  }, [view]);

  useEffect(() => {
    load('unread');
    const id = window.setInterval(() => load(view), 60000);
    return () => window.clearInterval(id);
  }, [load, view]);

  useEffect(() => {
    if (open) load(view);
  }, [load, open, view]);

  const markRead = async (ids: string[] | 'all') => {
    await fetch('/api/notifications/mark-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ids === 'all' ? { all: true } : { ids }),
    });
    await load(view);
  };

  const openNotification = async (notification: NotificationRecord) => {
    if (!notification.read_at) {
      await markRead([notification.id]);
    }
    setOpen(false);
    if (notification.href) router.push(notification.href);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`relative inline-flex items-center justify-center rounded-md text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white ${
            compact ? 'h-9 w-9' : 'h-8 w-8'
          }`}
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 ? (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent-3)] px-1 text-[10px] font-semibold leading-none text-white">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={compact ? 'end' : 'end'}
        side={compact ? 'bottom' : 'right'}
        className="w-[min(640px,calc(100vw-24px))] border border-neutral-200 bg-white p-0 shadow-lg dark:border-neutral-700 dark:bg-neutral-800"
      >
        <div className="flex items-center justify-between gap-2 px-3 py-2.5">
          <div>
            <p className="text-sm font-semibold text-neutral-900 dark:text-white">
              Notifications
            </p>
            <p className="text-xs text-neutral-500">
              {unreadCount} unread
            </p>
          </div>
          <button
            type="button"
            onClick={() => markRead('all')}
            disabled={unreadCount === 0}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-40 dark:hover:bg-neutral-800 dark:hover:text-white"
            aria-label="Mark all read"
          >
            <CheckCheck className="h-4 w-4" />
          </button>
        </div>
        <div className="flex border-y border-neutral-200 p-1 dark:border-neutral-800">
          {(['unread', 'all'] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => {
                setView(mode);
                load(mode);
              }}
              className={`h-7 flex-1 rounded text-xs font-medium capitalize transition-colors ${
                view === mode
                  ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-950'
                  : 'text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
        <div className="max-h-[720px] overflow-y-auto py-1">
          {loading && notifications.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-neutral-500">
              Loading
            </div>
          ) : notifications.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-neutral-500">
              No notifications
            </div>
          ) : (
            notifications.map((notification) => {
              const actorName = notification.actor_name ?? 'System';
              const unread = !notification.read_at;
              return (
                <DropdownMenuItem
                  key={notification.id}
                  asChild
                  className="cursor-pointer px-0 py-0 focus:bg-transparent data-[highlighted]:bg-transparent"
                >
                  <button
                    type="button"
                    onClick={() => openNotification(notification)}
                    className="mx-1 flex w-[calc(100%-0.5rem)] items-start gap-2.5 rounded-md px-3 py-3 text-left transition hover:bg-neutral-50 hover:shadow-md dark:hover:bg-white/[0.06] dark:hover:shadow-none"
                  >
                    <span className="relative mt-0.5 shrink-0">
                      <UserAvatar name={actorName} size="sm" />
                      {unread ? (
                        <span
                          aria-hidden
                          className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-[var(--accent-3)] ring-2 ring-white dark:ring-neutral-800"
                        />
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-900 dark:text-white">
                          {notification.title}
                        </span>
                        <span className="shrink-0 text-[11px] text-neutral-400 dark:text-neutral-500">
                          {formatRelative(notification.created_at)}
                        </span>
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-neutral-500 dark:text-neutral-400">
                        {notification.body}
                      </span>
                    </span>
                  </button>
                </DropdownMenuItem>
              );
            })
          )}
        </div>
        <DropdownMenuSeparator />
        <div className="px-2 py-1.5">
          <Link
            href="/profile"
            className="block rounded-md px-2 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-white"
            onClick={() => setOpen(false)}
          >
            Notification settings
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
