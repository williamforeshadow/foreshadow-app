'use client';

import Link from 'next/link';
import { UserAvatar } from '@/components/ui/user-avatar';
import { formatRelative } from '@/src/lib/dates';
import type { GuestConversation } from '@/lib/messages';

/**
 * The left-pane inbox: one row per conversation thread. Each row links to its
 * own route (/messages/[conversationId]); the open one is highlighted via
 * `activeId`. Read-only in v1. Row styling mirrors NotificationRows.
 */
export function ConversationList({
  conversations,
  loading,
  activeId,
  emptyLabel = 'No messages yet',
}: {
  conversations: GuestConversation[];
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
        const isActive = activeId === c.conversation_id;
        return (
          <Link
            key={c.conversation_id}
            href={`/messages/${encodeURIComponent(c.conversation_id)}`}
            className={`flex w-full items-start gap-2.5 px-3 py-3 text-left transition ${
              isActive
                ? 'bg-neutral-100 dark:bg-white/[0.08]'
                : 'hover:bg-neutral-50 dark:hover:bg-white/[0.06]'
            }`}
          >
            <span className="mt-0.5 shrink-0">
              <UserAvatar name={guestName} size="sm" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-900 dark:text-white">
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
              <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-neutral-500 dark:text-neutral-400">
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
