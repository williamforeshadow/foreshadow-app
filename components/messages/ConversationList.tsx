'use client';

import Link from 'next/link';
import { UserAvatar } from '@/components/ui/user-avatar';
import { formatRelative } from '@/src/lib/dates';
import type { ConversationRow } from '@/lib/conversations';

/**
 * Left-pane inbox: one row per conversation. Links to /messages/[id] (the
 * conversation uuid). Unread rows are highlighted (bold name + dot). The open
 * row is shaded via `activeId`.
 */
export function ConversationList({
  conversations,
  loading,
  activeId,
  emptyLabel = 'No messages yet',
}: {
  conversations: ConversationRow[];
  loading: boolean;
  activeId?: string | null;
  emptyLabel?: string;
}) {
  if (loading && conversations.length === 0) {
    return (
      <div className="px-3 py-8 text-center text-sm text-neutral-500">Loading</div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="px-3 py-8 text-center text-sm text-neutral-500">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="divide-y divide-[var(--surface-elevated-divider)]">
      {conversations.map((c) => {
        const guestName = c.guest_name ?? 'Guest';
        const isActive = activeId === c.id;
        const unread = c.unread;
        return (
          <Link
            key={c.id}
            href={`/messages/${c.id}`}
            className={`flex w-full items-start gap-2.5 px-3 py-3 text-left transition ${
              isActive
                ? 'bg-neutral-100 dark:bg-white/[0.08]'
                : 'hover:bg-neutral-50 dark:hover:bg-white/[0.06]'
            }`}
          >
            <span className="relative mt-0.5 shrink-0">
              <UserAvatar name={guestName} size="sm" />
              {unread ? (
                <span
                  aria-hidden
                  className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[var(--accent-3)] ring-2 ring-[var(--surface-elevated)]"
                />
              ) : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span
                  className={`min-w-0 flex-1 truncate text-sm ${
                    unread
                      ? 'font-semibold text-neutral-900 dark:text-white'
                      : 'font-medium text-neutral-800 dark:text-neutral-200'
                  }`}
                >
                  {guestName}
                  {c.message_count > 1 ? (
                    <span className="ml-2 rounded-full bg-neutral-200 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600 dark:bg-white/10 dark:text-neutral-300">
                      {c.message_count}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-[11px] text-neutral-400 dark:text-neutral-500">
                  {formatRelative(c.last_message_at ?? '')}
                </span>
              </span>
              {c.property_name ? (
                <span className="mt-0.5 block truncate text-[11px] text-neutral-400 dark:text-neutral-500">
                  {c.property_name}
                </span>
              ) : null}
              <span
                className={`mt-0.5 line-clamp-2 block text-xs leading-5 ${
                  unread
                    ? 'text-neutral-700 dark:text-neutral-200'
                    : 'text-neutral-500 dark:text-neutral-400'
                }`}
              >
                {c.last_direction === 'outbound' ? 'You: ' : ''}
                {c.last_message_preview}
              </span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}
