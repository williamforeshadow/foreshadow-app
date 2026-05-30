'use client';

import { UserAvatar } from '@/components/ui/user-avatar';
import { formatRelative } from '@/src/lib/dates';
import type { NotificationRecord } from '@/lib/notifications';
import type { NotificationView } from './useNotificationFeed';

/**
 * Unread / All segmented toggle. Shared by the desktop dropdown and the mobile
 * notifications page so both read identically.
 */
export function NotificationViewTabs({
  view,
  onChange,
}: {
  view: NotificationView;
  onChange: (view: NotificationView) => void;
}) {
  return (
    <div className="flex border-y border-[var(--surface-elevated-divider)] p-1">
      {(['unread', 'all'] as NotificationView[]).map((mode) => (
        <button
          key={mode}
          type="button"
          onClick={() => onChange(mode)}
          className={`h-7 flex-1 rounded text-xs font-medium capitalize transition-colors ${
            view === mode
              ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-950'
              : 'text-neutral-500 hover:bg-neutral-100 dark:hover:bg-white/10'
          }`}
        >
          {mode}
        </button>
      ))}
    </div>
  );
}

/**
 * The notification rows themselves — full-width rows separated by hairlines,
 * with avatar, unread dot, title, relative time, and a two-line body. Shared
 * between the desktop dropdown and the mobile page.
 *
 * `ringClassName` colors the gap ring around the unread dot so it blends into
 * whatever surface the list sits on (glass popout vs. page background).
 */
export function NotificationRows({
  notifications,
  loading,
  onOpen,
  ringClassName = 'ring-[var(--surface-elevated)]',
}: {
  notifications: NotificationRecord[];
  loading: boolean;
  onOpen: (notification: NotificationRecord) => void;
  ringClassName?: string;
}) {
  if (loading && notifications.length === 0) {
    return (
      <div className="px-3 py-8 text-center text-sm text-neutral-500">
        Loading
      </div>
    );
  }

  if (notifications.length === 0) {
    return (
      <div className="px-3 py-8 text-center text-sm text-neutral-500">
        No notifications
      </div>
    );
  }

  return (
    <div className="divide-y divide-[var(--surface-elevated-divider)]">
      {notifications.map((notification) => {
        const actorName = notification.actor_name ?? 'System';
        const unread = !notification.read_at;
        return (
          <button
            key={notification.id}
            type="button"
            onClick={() => onOpen(notification)}
            className="flex w-full items-start gap-2.5 px-3 py-3 text-left transition hover:bg-neutral-50 dark:hover:bg-white/[0.06]"
          >
            <span className="relative mt-0.5 shrink-0">
              <UserAvatar name={actorName} size="sm" />
              {unread ? (
                <span
                  aria-hidden
                  className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-[var(--accent-3)] ring-2 ${ringClassName}`}
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
        );
      })}
    </div>
  );
}
