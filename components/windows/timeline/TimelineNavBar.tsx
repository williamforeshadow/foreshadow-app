'use client';

// Compact unified segmented control for the Timeline header:
//   ‹  Today  ›  │  Week  Month
// The Week/Month segment only shows in grid view (`showViewToggle`). Nav
// behavior is supplied by the parent (it differs grid vs day-view Kanban).

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

const SEG =
  'px-3 py-1.5 text-sm font-medium transition-colors text-[#6b6963] dark:text-[#9a9893] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] hover:text-[#1a1a18] dark:hover:text-[#e8e7e3]';
const ICON_SEG =
  'px-2 py-1.5 transition-colors text-[#9a9892] dark:text-[#66645f] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] hover:text-[#1a1a18] dark:hover:text-[#e8e7e3] flex items-center';
const ACTIVE =
  'bg-[rgba(30,25,20,0.06)] dark:bg-[rgba(255,255,255,0.08)] text-[#1a1a18] dark:text-[#e8e7e3] hover:text-[#1a1a18] dark:hover:text-[#e8e7e3]';

export function TimelineNavBar({
  showViewToggle,
  view,
  onView,
  onPrev,
  onToday,
  onNext,
}: {
  showViewToggle: boolean;
  view: 'week' | 'month';
  onView: (v: 'week' | 'month') => void;
  onPrev: () => void;
  onToday: () => void;
  onNext: () => void;
}) {
  const divider = (
    <span className="w-px self-stretch bg-[rgba(30,25,20,0.08)] dark:bg-[var(--timeline-border-strong)]" />
  );

  return (
    <div className="inline-flex items-center gap-2">
      {/* Date navigation pill */}
      <div className="inline-flex items-stretch rounded-lg border border-[rgba(30,25,20,0.08)] dark:border-[var(--timeline-border-strong)] bg-white dark:bg-[var(--timeline-surface-2)] overflow-hidden">
        <button type="button" onClick={onPrev} className={ICON_SEG} title="Previous">
          <ChevronLeft className="w-4 h-4" />
        </button>
        {divider}
        <button type="button" onClick={onToday} className={SEG} title="Today">
          Today
        </button>
        {divider}
        <button type="button" onClick={onNext} className={ICON_SEG} title="Next">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Week/Month toggle pill (grid view only) */}
      {showViewToggle && (
        <div className="inline-flex items-stretch rounded-lg border border-[rgba(30,25,20,0.08)] dark:border-[var(--timeline-border-strong)] bg-white dark:bg-[var(--timeline-surface-2)] overflow-hidden">
          <button
            type="button"
            onClick={() => onView('week')}
            className={cn(SEG, view === 'week' && ACTIVE)}
          >
            Week
          </button>
          <button
            type="button"
            onClick={() => onView('month')}
            className={cn(SEG, view === 'month' && ACTIVE)}
          >
            Month
          </button>
        </div>
      )}
    </div>
  );
}
