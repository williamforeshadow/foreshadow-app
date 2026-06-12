'use client';

import type { ConversationTab, ConversationCounts } from '@/lib/conversations';

/**
 * Active / Complete segmented control sunk into the glass pane as a well.
 * Active shows an unread-count badge (the highlight count).
 */
export function ConversationTabs({
  tab,
  onChange,
  counts,
}: {
  tab: ConversationTab;
  onChange: (tab: ConversationTab) => void;
  counts: ConversationCounts;
}) {
  const items: { key: ConversationTab; label: string; badge?: number }[] = [
    { key: 'active', label: 'Active', badge: counts.unread },
    { key: 'complete', label: 'Complete' },
  ];
  return (
    <div className="shrink-0 px-3 pb-2">
      <div className="msg-well flex gap-1 rounded-lg p-1">
        {items.map((it) => {
          const active = tab === it.key;
          return (
            <button
              key={it.key}
              type="button"
              onClick={() => onChange(it.key)}
              aria-pressed={active}
              className={`inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors duration-150 ${
                active
                  ? 'bg-[var(--accent-3)] text-white shadow-sm'
                  : 'text-muted-foreground hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.05]'
              }`}
            >
              {it.label}
              {it.badge ? (
                <span
                  className={`rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${
                    active
                      ? 'bg-white/25 text-white'
                      : 'bg-[var(--accent-3)] text-white'
                  }`}
                >
                  {it.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
