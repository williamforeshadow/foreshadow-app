'use client';

import { memo, useState } from 'react';
import Link from 'next/link';
import MobileDrawer from './MobileDrawer';

interface MobileRouteShellProps {
  children: React.ReactNode;
  /**
   * When provided, renders a back-arrow button linking to this href.
   * When omitted, renders a hamburger button that opens the drawer.
   *
   * Convention: section "root" pages (e.g. /properties) show the hamburger;
   * detail pages nested inside (e.g. /properties/[id]) show back.
   */
  backHref?: string;
  /**
   * Optional right-aligned content for the top bar (e.g. an overflow menu).
   */
  rightSlot?: React.ReactNode;
}

/**
 * Reusable shell for routed mobile pages (anything outside of the operational
 * `/` view owned by MobileApp). Provides:
 *  - A minimal top bar with back arrow or hamburger
 *  - Safe-area padding (top + bottom) — no bottom nav here
 *  - Self-rendered MobileDrawer that navigates via next/router
 *
 * Pages are responsible for their own internal scroll container; this shell's
 * <main> is `overflow-hidden` and lets children own the scroll region.
 */
const MobileRouteShell = memo(function MobileRouteShell({
  children,
  backHref,
  rightSlot,
}: MobileRouteShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      <div className="h-dvh bg-neutral-50 dark:bg-background overflow-hidden flex flex-col safe-area-top safe-area-bottom">
        {/* Top bar */}
        <div className="flex-shrink-0 h-11 px-2 flex items-center justify-between gap-1">
          <div className="flex items-center">
            {backHref ? (
              <Link
                href={backHref}
                className="w-10 h-10 flex items-center justify-center rounded-lg text-neutral-700 dark:text-[#a09e9a] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] transition-colors"
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
            ) : (
              <button
                onClick={() => setDrawerOpen(true)}
                className="w-10 h-10 flex items-center justify-center rounded-lg text-neutral-700 dark:text-[#a09e9a] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] transition-colors"
                aria-label="Open menu"
              >
                <svg
                  className="w-[22px] h-[22px]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.75}
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            )}
          </div>

          <div className="flex items-center">{rightSlot}</div>
        </div>

        {/* Content region — children own the scroll */}
        <main className="flex-1 min-h-0 overflow-hidden">{children}</main>
      </div>

      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </>
  );
});

export default MobileRouteShell;
