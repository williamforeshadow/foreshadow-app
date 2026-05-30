'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { NotificationRecord } from '@/lib/notifications';
import { useNotificationFeed } from './useNotificationFeed';
import { NotificationRows, NotificationViewTabs } from './NotificationList';

export function NotificationBell({
  compact = false,
  onOpenChange,
}: {
  compact?: boolean;
  /** Notified whenever the notifications dropdown opens or closes. */
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { view, setView, notifications, unreadCount, loading, markRead } =
    useNotificationFeed();

  const badge =
    unreadCount > 0 ? (
      <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent-3)] px-1 text-[10px] font-semibold leading-none text-white">
        {unreadCount > 9 ? '9+' : unreadCount}
      </span>
    ) : null;

  // Mobile: the bell is a plain link into the dedicated /notifications page
  // (no dropdown). The unread badge still polls via the shared feed hook.
  if (compact) {
    return (
      <Link
        href="/notifications"
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white"
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {badge}
      </Link>
    );
  }

  const openNotification = async (notification: NotificationRecord) => {
    if (!notification.read_at) {
      await markRead([notification.id]);
    }
    setOpen(false);
    if (notification.href) router.push(notification.href);
  };

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        onOpenChange?.(next);
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="relative inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
          {badge}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="right"
        alignOffset={8}
        className="relative w-[min(640px,calc(100vw-24px))] overflow-hidden border border-[var(--surface-elevated-line)] p-0 shadow-[var(--glass-shadow)]"
      >
        {/* Liquid-glass backing. Lives on its own non-transformed layer so
            Chromium actually renders the backdrop blur (it drops blur when the
            element itself is positioned via transform, as Radix does here). */}
        <div
          aria-hidden
          className="liquid-glass-surface pointer-events-none absolute inset-0 -z-10 rounded-[inherit]"
        />
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
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-40 dark:hover:bg-white/10 dark:hover:text-white"
            aria-label="Mark all read"
          >
            <CheckCheck className="h-4 w-4" />
          </button>
        </div>
        <NotificationViewTabs view={view} onChange={setView} />
        <div className="max-h-[720px] overflow-y-auto">
          <NotificationRows
            notifications={notifications}
            loading={loading}
            onOpen={openNotification}
          />
        </div>
        <DropdownMenuSeparator />
        <div className="px-2 py-1.5">
          <Link
            href="/profile"
            className="block rounded-md px-2 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white"
            onClick={() => setOpen(false)}
          >
            Notification settings
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
