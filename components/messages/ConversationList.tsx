'use client';

import { useState } from 'react';
import { UserAvatar } from '@/components/ui/user-avatar';
import { formatRelative } from '@/src/lib/dates';
import type { GuestConversation } from '@/lib/messages';

/**
 * Inbox of guest conversations — one row per thread. Tapping a row expands it to
 * show the full back-and-forth as chat bubbles (guest left, host right).
 * Read-only in v1 (no replies). Mirrors the NotificationRows row styling.
 */
export function ConversationList({
  conversations,
  loading,
}: {
  conversations: GuestConversation[];
  loading: boolean;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (loading && conversations.length === 0) {
    return (
      <div className="px-3 py-8 text-center text-sm text-neutral-500">Loading</div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="px-3 py-8 text-center text-sm text-neutral-500">
        No messages yet
      </div>
    );
  }

  return (
    <div className="divide-y divide-[var(--surface-elevated-divider)]">
      {conversations.map((c) => {
        const guestName = c.guest_name ?? 'Guest';
        const isOpen = expanded.has(c.conversation_id);
        return (
          <div key={c.conversation_id}>
            <button
              type="button"
              onClick={() => toggle(c.conversation_id)}
              className="flex w-full items-start gap-2.5 px-3 py-3 text-left transition hover:bg-neutral-50 dark:hover:bg-white/[0.06]"
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
            </button>

            {isOpen ? (
              <div className="space-y-2 bg-neutral-50/60 px-3 py-3 dark:bg-white/[0.03]">
                {c.messages.map((m) => {
                  const outbound = m.direction === 'outbound';
                  return (
                    <div
                      key={m.id}
                      className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-2xl px-3 py-2 text-xs leading-5 ${
                          outbound
                            ? 'bg-[var(--accent-3)] text-white'
                            : 'bg-white text-neutral-800 ring-1 ring-neutral-200 dark:bg-white/10 dark:text-neutral-100 dark:ring-white/10'
                        }`}
                      >
                        <div className="whitespace-pre-wrap break-words">
                          {m.body?.trim() ? m.body : '(no text)'}
                        </div>
                        <div
                          className={`mt-1 text-[10px] ${
                            outbound ? 'text-white/70' : 'text-neutral-400'
                          }`}
                        >
                          {formatRelative(m.sent_at ?? m.created_at)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
