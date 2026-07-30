'use client';

import type { ConversationTab } from '@/lib/conversations';

/**
 * Active / Complete tabs as a minimal underline row — the active option is
 * marked by an accent underline, no segmented "well" and no count badge.
 */
export function ConversationTabs({
  tab,
  onChange,
}: {
  tab: ConversationTab;
  onChange: (tab: ConversationTab) => void;
}) {
  const items: { key: ConversationTab; label: string }[] = [
    { key: 'active', label: 'Active' },
    { key: 'complete', label: 'Complete' },
  ];
  // Bare row: this sits inside the WindowHeader's control row now, which
  // supplies the padding and owns the bottom border. The underline marks the
  // label itself rather than anchoring to that border, since the control row
  // is vertically centred and sits 16px clear of it.
  return (
    <div className="flex shrink-0 gap-5">
      {items.map((it) => {
        const active = tab === it.key;
        return (
          <button
            key={it.key}
            type="button"
            onClick={() => onChange(it.key)}
            aria-pressed={active}
            className={`relative py-1 text-sm font-medium transition-colors ${
              active
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {it.label}
            {active ? (
              <span
                aria-hidden
                className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-[var(--accent-3)] dark:bg-[var(--accent-1)]"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
