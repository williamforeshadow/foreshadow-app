'use client';

import { formatRelative } from '@/src/lib/dates';
import type { GuestMessageRecord } from '@/lib/messages';

/**
 * The full conversation as chat bubbles (guest left, host right). Used as the
 * center pane on desktop and the full-screen detail on mobile. Read-only in v1.
 */
export function ConversationThread({
  messages,
  guestName,
  propertyName,
  loading,
  showHeader = true,
}: {
  messages: GuestMessageRecord[];
  guestName?: string | null;
  propertyName?: string | null;
  loading: boolean;
  showHeader?: boolean;
}) {
  if (loading && messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-neutral-400">
        Loading
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {showHeader ? (
        <div className="shrink-0 border-b border-[var(--surface-elevated-divider)] px-4 py-3">
          <div className="text-sm font-semibold text-neutral-900 dark:text-white">
            {guestName ?? 'Guest'}
          </div>
          {propertyName ? (
            <div className="text-[11px] text-neutral-400 dark:text-neutral-500">
              {propertyName}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="py-8 text-center text-sm text-neutral-400">
            No messages
          </div>
        ) : (
          messages.map((m) => {
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
          })
        )}
      </div>
    </div>
  );
}
