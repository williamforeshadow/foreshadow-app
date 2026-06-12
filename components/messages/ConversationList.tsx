'use client';

import Link from 'next/link';
import { Inbox } from 'lucide-react';
import { UserAvatar } from '@/components/ui/user-avatar';
import { formatRelative } from '@/src/lib/dates';
import { stageMeta } from '@/components/messages/stage';
import type { ConversationRow } from '@/lib/conversations';

/**
 * Left-pane inbox: one row per conversation. Links to /messages/[id] (the
 * conversation uuid). Rows are inset rounded tiles on the glass pane; unread
 * rows get a violet dot beside the timestamp + bold name, the open row takes
 * the Signal Violet selection tint via `activeId`. Each row carries a stage
 * chip (reservation_status, derived server-side) — violet only for "current".
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
        <span className="msg-well flex h-11 w-11 items-center justify-center rounded-2xl text-muted-foreground">
          <Inbox className="h-5 w-5" />
        </span>
        <p className="text-sm font-medium text-foreground">{emptyLabel}</p>
        <p className="max-w-[14rem] text-xs leading-relaxed text-muted-foreground">
          Guest messages from your channels land here as conversations.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 px-2 pb-2 pt-1">
      {conversations.map((c) => {
        const guestName = c.guest_name ?? 'Guest';
        const isActive = activeId === c.id;
        const unread = c.unread;
        const stage = stageMeta(c.reservation_status);
        return (
          <Link
            key={c.id}
            href={`/messages/${c.id}`}
            aria-current={isActive ? 'page' : undefined}
            className={`flex w-full items-start gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors duration-150 ${
              isActive
                ? 'bg-[var(--accent-bg-soft)] ring-1 ring-inset ring-[var(--accent-3)]/20 dark:bg-[var(--accent-bg-soft-dark)] dark:ring-[var(--accent-1)]/20'
                : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.04]'
            }`}
          >
            <span className="mt-0.5 shrink-0">
              <UserAvatar name={guestName} size="md" />
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
                    <span className="ml-2 rounded-full bg-black/[0.05] px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground dark:bg-white/[0.08]">
                      {c.message_count}
                    </span>
                  ) : null}
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span
                    className={`text-xs tabular-nums ${
                      unread
                        ? 'font-medium text-[var(--accent-3)] dark:text-[var(--accent-1)]'
                        : 'text-muted-foreground'
                    }`}
                  >
                    {formatRelative(c.last_message_at ?? '')}
                  </span>
                  {unread ? (
                    <span
                      aria-hidden
                      className="h-2 w-2 rounded-full bg-[var(--accent-3)] dark:bg-[var(--accent-1)]"
                    />
                  ) : null}
                </span>
              </span>
              {c.property_name || stage ? (
                <span className="mt-0.5 flex items-center gap-1.5">
                  {c.property_name ? (
                    <span className="min-w-0 truncate text-xs text-muted-foreground">
                      {c.property_name}
                    </span>
                  ) : null}
                  {stage ? (
                    <span
                      className={`shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium ${stage.className}`}
                    >
                      {stage.label}
                    </span>
                  ) : null}
                </span>
              ) : null}
              <span
                className={`mt-1 line-clamp-2 text-[13px] leading-5 ${
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
    <div className="flex flex-col gap-0.5 px-2 pb-2 pt-1" aria-hidden>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 rounded-xl px-2.5 py-2.5">
          <span className="mt-0.5 h-8 w-8 shrink-0 animate-pulse rounded-full bg-black/[0.06] dark:bg-white/[0.07]" />
          <span className="min-w-0 flex-1 space-y-2 py-0.5">
            <span className="flex items-center justify-between gap-2">
              <span className="h-3 w-28 animate-pulse rounded bg-black/[0.06] dark:bg-white/[0.07]" />
              <span className="h-2.5 w-8 animate-pulse rounded bg-black/[0.06] dark:bg-white/[0.07]" />
            </span>
            <span className="block h-2.5 w-20 animate-pulse rounded bg-black/[0.06] dark:bg-white/[0.07]" />
            <span className="block h-2.5 w-full animate-pulse rounded bg-black/[0.06] dark:bg-white/[0.07]" />
          </span>
        </div>
      ))}
    </div>
  );
}
