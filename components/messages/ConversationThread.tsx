'use client';

import { formatRelative } from '@/src/lib/dates';
import type { GuestConversation } from '@/lib/messages';

/**
 * The full conversation, rendered as chat bubbles (guest left, host right).
 * Used as the right pane on desktop and the full-screen detail on mobile.
 * Read-only in v1 (no reply composer yet).
 */
export function ConversationThread({
  conversation,
  loading,
  showHeader = true,
}: {
  conversation: GuestConversation | undefined;
  loading: boolean;
  showHeader?: boolean;
}) {
  if (!conversation) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-neutral-400">
        {loading ? 'Loading' : 'Conversation not found'}
      </div>
    );
  }

  const guestName = conversation.guest_name ?? 'Guest';

  return (
    <div className="flex h-full flex-col">
      {showHeader ? (
        <div className="shrink-0 border-b border-[var(--surface-elevated-divider)] px-4 py-3">
          <div className="text-sm font-semibold text-neutral-900 dark:text-white">
            {guestName}
          </div>
          {conversation.property_name ? (
            <div className="text-[11px] text-neutral-400 dark:text-neutral-500">
              {conversation.property_name}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {conversation.messages.map((m) => {
          const outbound = m.direction === 'outbound';
          return (
            <div
              key={m.id}
              className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm leading-5 ${
                  outbound
                    ? 'bg-[var(--accent-3)] text-white'
                    : 'bg-neutral-100 text-neutral-800 dark:bg-white/10 dark:text-neutral-100'
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
    </div>
  );
}
