'use client';

// Lightweight nav for the demo — replaces the app sidebar. Only Schedule is
// live; Bins / My Assignments are visible with a "Soon" pill (built next).

type TabId = 'schedule' | 'bins' | 'assignments';

const TABS: { id: TabId; label: string; soon: boolean }[] = [
  { id: 'schedule', label: 'Schedule', soon: false },
  { id: 'bins', label: 'Bins', soon: true },
  { id: 'assignments', label: 'My Assignments', soon: true },
];

export function DemoTabs({ active = 'schedule' }: { active?: TabId }) {
  return (
    <div className="flex-shrink-0 flex items-center gap-1 px-4 h-[52px] bg-white dark:bg-card border-b border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)]">
      {TABS.map((t) => {
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            aria-current={isActive ? 'page' : undefined}
            className={`relative inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors cursor-default ${
              isActive
                ? 'bg-[rgba(167,139,250,0.14)] text-[#8b7fc9] dark:text-[#a78bfa]'
                : 'text-neutral-500 dark:text-[#9a9893]'
            }`}
          >
            {t.label}
            {t.soon && (
              <span className="text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded-full bg-neutral-200/70 dark:bg-[rgba(255,255,255,0.08)] text-neutral-500 dark:text-[#66645f]">
                Soon
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
