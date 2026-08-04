'use client';

import { memo } from 'react';
import Link from 'next/link';
import { useBackNavigation } from '@/lib/navigationHistoryTracker';

interface MobileRouteShellProps {
  children: React.ReactNode;
  /**
   * When provided, renders a back-arrow button. When omitted, no left button
   * renders — tab-root pages rely on the global bottom tab bar for navigation
   * instead.
   *
   * The arrow pops in-app history rather than navigating here, so it returns to
   * whichever screen the user actually came from. This href is the *fallback*,
   * used only on a cold entry with no history to pop (a Slack link, a push
   * notification, a bookmark) — so it should name the page's hierarchical
   * parent, which is exactly what it meant before.
   */
  backHref?: string;
  /**
   * Optional title rendered inline next to the hamburger / back button.
   * When set, the page should NOT render its own <h1> for the same label.
   */
  title?: string;
  /**
   * Optional secondary line rendered under the title (e.g. a conversation's
   * property + stay dates). When present the title shrinks a touch so both lines
   * sit within the top bar. Accepts a node so callers can pin part of it (a date
   * range) against a truncating part (a property name).
   */
  subtitle?: React.ReactNode;
  /**
   * Optional right-aligned content for the top bar (e.g. an overflow menu).
   */
  rightSlot?: React.ReactNode;
}

/**
 * Reusable shell for routed mobile pages (anything outside of the operational
 * `/` view owned by MobileApp). Provides:
 *  - A minimal top bar with an optional back arrow + title
 *  - Safe-area padding (top) — the global MobileBottomNav owns bottom chrome
 *
 * A drill-in detail page passes `backHref`; a tab-root page (e.g. Messages)
 * omits it and shows just the title, since navigation lives in the bottom tab
 * bar. Pages own their internal scroll container; this shell's <main> is
 * `overflow-hidden` and lets children own the scroll region.
 *
 * Every routed mobile page shares this one back arrow, so making it
 * history-aware here is what makes it history-aware everywhere.
 */
const MobileRouteShell = memo(function MobileRouteShell({
  children,
  backHref,
  title,
  subtitle,
  rightSlot,
}: MobileRouteShellProps) {
  const goBack = useBackNavigation();

  return (
    <div className="h-dvh bg-white dark:bg-card overflow-hidden flex flex-col safe-area-top">
        {/* Top bar */}
        <div className="flex-shrink-0 min-h-11 px-2 flex items-center gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {backHref ? (
              // Still a real <Link>: it keeps the href in the accessibility tree
              // and in the webview's long-press menu, and lets a modified click
              // open the parent page in a new tab. A plain click is intercepted
              // and popped instead.
              <Link
                href={backHref as never}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                  if (e.button !== 0) return;
                  e.preventDefault();
                  goBack(backHref);
                }}
                className="w-10 h-10 flex items-center justify-center rounded-lg text-neutral-700 dark:text-[#a09e9a] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] transition-colors shrink-0"
                aria-label="Back"
              >
                <svg
                  className="w-[22px] h-[22px]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.75}
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
            ) : null}
            {title && (
              <div className="min-w-0 flex-1">
                <h1
                  className={`font-semibold tracking-tight text-neutral-900 dark:text-[#f0efed] truncate ${
                    subtitle ? 'text-[17px] leading-tight' : 'text-[20px] leading-normal'
                  }`}
                >
                  {title}
                </h1>
                {subtitle ? (
                  <div className="mt-px flex min-w-0 items-center gap-1.5 text-[12px] leading-tight text-muted-foreground">
                    {subtitle}
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="flex items-center shrink-0">{rightSlot}</div>
        </div>

        {/* Content region — children own the scroll */}
        <main className="flex-1 min-h-0 overflow-hidden">{children}</main>
      </div>
  );
});

export default MobileRouteShell;
