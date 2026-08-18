'use client';

import { useCallback, useState } from 'react';
import { getDayLabel, getShortDate } from './TaskRow';

// Shared date-section model for task lists. Every task surface (Tasks,
// My Assignments, Property Tasks — desktop and mobile) groups its rows into
// per-day sections through groupTasksByDate() and renders headers through
// <TaskSectionHeader />, so the section design can only change in one place.
//
// Section semantics:
//   - Overdue is ONE section, not a section per stale date — a neglected list
//     would otherwise shatter into dozens of one-item sections.
//   - Every non-past date gets its own section ("WED · JUL 22"), today labeled
//     "TODAY · AUG 16".
//   - No date and Completed keep their own sections (per-day is meaningless
//     for them); Completed starts collapsed.
//
// Grouping preserves the input order, so callers sort BEFORE grouping and the
// user's sort choice orders rows within each section.

export type DateSectionKind = 'overdue' | 'day' | 'noDate' | 'completed';

export interface DateSection<T> {
  id: string; // 'overdue' | 'noDate' | 'completed' | 'day-YYYY-MM-DD'
  kind: DateSectionKind;
  label: string;
  items: T[];
  defaultCollapsed?: boolean;
}

interface DateSectionInput {
  scheduled_date?: string | null;
  status: string;
}

export function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** "Wed · Jul 22", or "Today · Aug 16" for today. Uppercased by the header's CSS. */
function daySectionLabel(dateISO: string, today: string): string {
  const short = getShortDate(dateISO);
  if (!short) return dateISO;
  const datePart = `${short.month} ${short.day}`;
  if (dateISO === today) return `Today · ${datePart}`;
  const weekday = getDayLabel(dateISO);
  return weekday ? `${weekday} · ${datePart}` : datePart;
}

export function groupTasksByDate<T extends DateSectionInput>(
  items: T[],
  opts: {
    /**
     * When true, complete items collect into a trailing collapsed "Completed"
     * section. When false they are dropped entirely (My Assignments never
     * shows completed work).
     */
    includeCompletedSection?: boolean;
    /**
     * Order of the per-day sections. Callers pass their sort direction when
     * sorting by scheduled date so section order follows the rows.
     */
    dayOrder?: 'asc' | 'desc';
  } = {}
): DateSection<T>[] {
  const { includeCompletedSection = false, dayOrder = 'asc' } = opts;
  const today = todayISO();

  const overdue: T[] = [];
  const noDate: T[] = [];
  const completed: T[] = [];
  const byDay = new Map<string, T[]>();

  for (const t of items) {
    if (t.status === 'complete') {
      if (includeCompletedSection) completed.push(t);
      continue;
    }
    const d = t.scheduled_date;
    if (!d) {
      noDate.push(t);
    } else if (d < today) {
      overdue.push(t);
    } else {
      const bucket = byDay.get(d);
      if (bucket) bucket.push(t);
      else byDay.set(d, [t]);
    }
  }

  const dayKeys = Array.from(byDay.keys()).sort();
  if (dayOrder === 'desc') dayKeys.reverse();

  const out: DateSection<T>[] = [];
  if (overdue.length)
    out.push({ id: 'overdue', kind: 'overdue', label: 'Overdue', items: overdue });
  for (const d of dayKeys)
    out.push({
      id: `day-${d}`,
      kind: 'day',
      label: daySectionLabel(d, today),
      items: byDay.get(d)!,
    });
  if (noDate.length)
    out.push({ id: 'noDate', kind: 'noDate', label: 'No date', items: noDate });
  if (completed.length)
    out.push({
      id: 'completed',
      kind: 'completed',
      label: 'Completed',
      items: completed,
      defaultCollapsed: true,
    });
  return out;
}

/** Collapse-state Set keyed by section id. Completed starts collapsed. */
export function useCollapsedSections(initial: string[] = ['completed']) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(initial));
  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  return { collapsed, toggle };
}

// ---- TaskSectionHeader ------------------------------------------------------
// Label on the left, chevron on the right. One component for desktop and
// mobile so the five surfaces can't drift.

export function TaskSectionHeader({
  label,
  collapsed,
  onToggle,
}: {
  label: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center justify-between w-full mb-3"
      aria-expanded={!collapsed}
    >
      <span className="text-[11px] font-semibold text-neutral-600 dark:text-[#a09e9a] uppercase tracking-[0.08em]">
        {label}
      </span>
      <span className="flex items-center gap-1.5">
        <svg
          className={`w-3 h-3 text-neutral-400 dark:text-[#66645f] transition-transform ${
            collapsed ? '-rotate-90' : ''
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </span>
    </button>
  );
}
