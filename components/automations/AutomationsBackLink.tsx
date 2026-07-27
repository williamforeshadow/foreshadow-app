'use client';

// Back to the hub, in the strip the tab bar used to occupy. Shared so the two
// lists carry an identical affordance in an identical place.

import Link from 'next/link';

const CHEVRON_LEFT = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M15 6l-6 6 6 6" />
  </svg>
);

export default function AutomationsBackLink() {
  return (
    <div
      className="flex shrink-0 items-center border-b px-3 py-2"
      style={{ borderColor: 'var(--task-line-soft)' }}
    >
      <Link
        href="/automations"
        className="flex items-center gap-1 rounded-lg px-2 py-1 font-mono text-[length:var(--task-fs-chip)] transition-colors hover:bg-[var(--task-surface-1)] hover:text-[var(--task-ink-1)]"
        style={{ color: 'var(--task-ink-3)' }}
      >
        {CHEVRON_LEFT}
        Automations
      </Link>
    </div>
  );
}
