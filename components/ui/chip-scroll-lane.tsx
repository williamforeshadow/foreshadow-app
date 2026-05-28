'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// Horizontally scrollable chip lane with explicit left/right chevron buttons.
// Wheel + touch scroll on the inner strip are intentionally disabled — the
// only way to advance through chips is via the chevrons. Chevrons disable
// (fade out, non-clickable) when there's no more room to scroll in that
// direction. Shared by the Schedule / Bins / Turnovers filter bars so the
// affordance reads identically everywhere.
const SCROLL_STEP_PX = 220;

export function ChipScrollLane({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    updateScrollState();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    // Observe descendant size changes too — when chips animate-in / change
    // their summary tail, the total scrollWidth shifts.
    for (const child of Array.from(el.children)) {
      ro.observe(child);
    }
    el.addEventListener('scroll', updateScrollState);
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', updateScrollState);
    };
  }, [updateScrollState, children]);

  const scrollBy = useCallback((delta: number) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: delta, behavior: 'smooth' });
  }, []);

  // overflow-x-hidden (not auto) so wheel/touch scrolling is blocked — the
  // chevrons are the only scroll affordance. `touch-pan-y` lets vertical
  // touch scroll on the surrounding page pass through.
  return (
    <div className="flex items-center gap-1 min-w-0 flex-1">
      <button
        type="button"
        onClick={() => scrollBy(-SCROLL_STEP_PX)}
        disabled={!canScrollLeft}
        aria-label="Scroll filters left"
        className={`flex-shrink-0 p-1 rounded transition-opacity ${
          canScrollLeft
            ? 'text-neutral-500 hover:text-neutral-800 dark:text-[#a09e9a] dark:hover:text-[#f0efed] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] cursor-pointer'
            : 'text-neutral-300 dark:text-[#3a3a3a] opacity-30 cursor-default pointer-events-none'
        }`}
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <div
        ref={ref}
        className="flex items-center gap-2 flex-nowrap min-w-0 flex-1 overflow-x-hidden touch-pan-y"
      >
        {children}
      </div>
      <button
        type="button"
        onClick={() => scrollBy(SCROLL_STEP_PX)}
        disabled={!canScrollRight}
        aria-label="Scroll filters right"
        className={`flex-shrink-0 p-1 rounded transition-opacity ${
          canScrollRight
            ? 'text-neutral-500 hover:text-neutral-800 dark:text-[#a09e9a] dark:hover:text-[#f0efed] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] cursor-pointer'
            : 'text-neutral-300 dark:text-[#3a3a3a] opacity-30 cursor-default pointer-events-none'
        }`}
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}
