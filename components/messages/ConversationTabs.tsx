'use client';

import type { ConversationTab, ConversationCounts } from '@/lib/conversations';

/**
 * Active / Complete tabs. Active shows an unread-count badge (the highlight
 * count). Mirrors NotificationViewTabs styling.
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
    <div className="flex shrink-0 gap-1 border-b border-[var(--surface-elevated-divider)] px-2 py-1.5">
      {items.map((it) => {
        const active = tab === it.key;
        return (
          <button
            key={it.key}
            type="button"
            onClick={() => onChange(it.key)}
            aria-pressed={active}
            className={`inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors ${
              active
                ? 'bg-[var(--accent-3)] text-white shadow-sm'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
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
  );
}
