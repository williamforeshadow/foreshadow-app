'use client';

import { UserAvatar } from '@/components/ui/user-avatar';
import { formatRelative } from '@/src/lib/dates';
import type { GuestMessageRecord } from '@/lib/messages';

/**
 * The guest-message rows — full-width hairline-separated rows with an avatar,
 * guest name + direction, relative time, and a two-line body. Read-only in v1
 * (no click handlers, no reply). Mirrors NotificationRows.
 */
export function MessageList({
  messages,
  loading,
}: {
  messages: GuestMessageRecord[];
  loading: boolean;
}) {
  if (loading && messages.length === 0) {
    return (
      <div className="px-3 py-8 text-center text-sm text-neutral-500">
        Loading
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="px-3 py-8 text-center text-sm text-neutral-500">
        No messages yet
      </div>
    );
  }

  return (
    <div className="divide-y divide-[var(--surface-elevated-divider)]">
      {messages.map((message) => {
        const guestName = message.guest_name ?? 'Guest';
        const outbound = message.direction === 'outbound';
        return (
          <div
            key={message.id}
            className="flex w-full items-start gap-2.5 px-3 py-3 text-left"
          >
            <span className="mt-0.5 shrink-0">
              <UserAvatar name={guestName} size="sm" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-900 dark:text-white">
                  {guestName}
                  <span className="ml-2 text-[11px] font-normal text-neutral-400 dark:text-neutral-500">
                    {outbound ? 'You' : 'Guest'}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] text-neutral-400 dark:text-neutral-500">
                  {formatRelative(message.sent_at ?? message.created_at)}
                </span>
              </span>
              {message.property_name ? (
                <span className="mt-0.5 block truncate text-[11px] text-neutral-400 dark:text-neutral-500">
                  {message.property_name}
                </span>
              ) : null}
              <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-neutral-500 dark:text-neutral-400">
                {message.body}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
