'use client';

import Link from 'next/link';
import { Inbox } from 'lucide-react';
import { UserAvatar } from '@/components/ui/user-avatar';
import { formatRelative } from '@/src/lib/dates';
import type { ConversationRow } from '@/lib/conversations';

/**
 * Left-pane inbox: one row per conversation. Links to /messages/[id] (the
 * conversation uuid). Unread rows are highlighted (bold name + accent dot). The
 * open row is shaded with the Signal Violet selection tint via `activeId`.
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
    return <ConversationListSkeleton />;
  }

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-muted-foreground">
          <Inbox className="h-5 w-5" />
        </span>
        <p className="text-sm font-medium text-foreground">{emptyLabel}</p>
        <p className="max-w-[14rem] text-xs text-muted-foreground">
          Guest messages from your channels land here as conversations.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {conversations.map((c) => {
        const guestName = c.guest_name ?? 'Guest';
        const isActive = activeId === c.id;
        const unread = c.unread;
        return (
          <Link
            key={c.id}
            href={`/messages/${c.id}`}
            aria-current={isActive ? 'page' : undefined}
            className={`flex w-full items-start gap-3 px-3 py-3 text-left transition-colors ${
              isActive
                ? 'bg-[var(--accent-bg-soft)] dark:bg-[var(--accent-bg-soft-dark)]'
                : 'hover:bg-accent/60'
            }`}
          >
            <span className="relative mt-0.5 shrink-0">
              <UserAvatar name={guestName} size="md" />
              {unread ? (
                <span
                  aria-hidden
                  className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-[var(--accent-3)] ring-2 ring-[var(--surface-elevated)]"
                />
              ) : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span
                  className={`min-w-0 flex-1 truncate text-sm ${
                    unread
                      ? 'font-semibold text-foreground'
                      : 'font-medium text-foreground/90'
                  }`}
                >
                  {guestName}
                  {c.message_count > 1 ? (
                    <span className="ml-2 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                      {c.message_count}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatRelative(c.last_message_at ?? '')}
                </span>
              </span>
              {c.property_name ? (
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {c.property_name}
                </span>
              ) : null}
              <span
                className={`mt-1 line-clamp-2 block text-[13px] leading-5 ${
                  unread ? 'text-foreground/80' : 'text-muted-foreground'
                }`}
              >
                {c.last_direction === 'outbound' ? (
                  <span className="font-medium text-foreground/70">You: </span>
                ) : null}
                {c.last_message_preview}
              </span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function ConversationListSkeleton() {
  return (
    <div className="flex flex-col" aria-hidden>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 px-3 py-3">
          <span className="mt-0.5 h-8 w-8 shrink-0 animate-pulse rounded-full bg-accent" />
          <span className="min-w-0 flex-1 space-y-2 py-0.5">
            <span className="flex items-center justify-between gap-2">
              <span className="h-3 w-28 animate-pulse rounded bg-accent" />
              <span className="h-2.5 w-8 animate-pulse rounded bg-accent" />
            </span>
            <span className="block h-2.5 w-20 animate-pulse rounded bg-accent" />
            <span className="block h-2.5 w-full animate-pulse rounded bg-accent" />
          </span>
        </div>
      ))}
    </div>
  );
}
