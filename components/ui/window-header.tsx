import type { ReactNode } from 'react';

// The one workspace header. Every page inside the app card wears this, so the
// title sits on the same baseline and the header measures the same 115px
// everywhere you navigate.
//
// The geometry is deliberately fixed rather than emergent:
//
//   24px padding + 36px h1 + 4px padding   = 64px title block
//   --window-header-row-h + 16px padding   = 51px control row
//                                            ─────
//                                            115px
//
// The control row renders even with no controls in it. That is the point —
// these headers used to size themselves to whatever they happened to contain
// and drifted 46 / 48 / 50px apart, so a page with no filters would sit
// visibly shorter than one beside it. An empty row costs nothing and keeps
// the title baseline identical across every route.
//
// `children` land in that row as a flex line; push trailing actions right
// with `ml-auto`.
// `inset` only changes horizontal padding, never the vertical rhythm — the
// 115px is the whole point and is identical in both.
//
//   'page'   a full-width page filling the app card (the default)
//   'column' one column of a split layout, e.g. the Messages inbox, where the
//            page's 32px gutter is too wide against a 320px column
//
// The title row keeps its right gutter in BOTH variants: the full-screen
// toggle is pinned to the card's top-right corner and overlaps the title row's
// vertical band, so any header that can end up rightmost needs the clearance.
// The control row doesn't — the toggle sits well above it.
export function WindowHeader({
  title,
  children,
  inset = 'page',
}: {
  title: ReactNode;
  children?: ReactNode;
  inset?: 'page' | 'column';
}) {
  const titleInset = inset === 'page' ? 'pl-8 pr-12' : 'pl-4 pr-12';
  const controlInset = inset === 'page' ? 'px-8' : 'px-4';

  return (
    <div className="flex-shrink-0 bg-white dark:bg-card bg-[linear-gradient(to_bottom,var(--header-scrim),transparent)] border-b border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)]">
      <div className={`pb-1 pt-6 ${titleInset}`}>
        <h1 className="truncate text-[24px] font-semibold leading-9 tracking-tight text-neutral-900 dark:text-[#f0efed]">
          {title}
        </h1>
      </div>
      <div className={`pb-4 ${controlInset}`}>
        <div className="flex h-[var(--window-header-row-h)] min-w-0 flex-nowrap items-center gap-2">
          {children}
        </div>
      </div>
    </div>
  );
}
