// Shared geometry for desktop detail panels
// ------------------------------------------
// All "right-side detail" panels in the app — task detail, reservation
// detail, day detail, timeline floating turnover — share this Tailwind
// class string so they line up exactly when one closes and another opens
// in the same surface. Visually this makes panel transitions feel like a
// swap in a single fixed slot rather than several differently-sized
// overlays competing for attention.
//
// Geometry contract (DESKTOP_DETAIL_PANEL_CLASS):
//   - `absolute inset-y-0 right-0` — anchors to the host's nearest
//     `relative` ancestor (typically the page's main content area, NOT
//     the viewport — so the sidebar is never covered).
//   - `w-1/3` — one-third of the host's content area (the established
//     baseline; `w-[30%] min-w-[320px]`, `w-1/2`, etc. were one-off
//     variants that have been retired).
//   - `z-20` — sits above the page content but below modals (z-50+) and
//     toasts.
//   - Background + left border standardized so internal panels don't
//     repeat them.
//   - **No layout opinion** (`flex` / `block` / scroll) — surfaces pick
//     what they need. Most use `flex flex-col overflow-hidden`
//     (`DESKTOP_DETAIL_PANEL_FLEX`) for a fixed-header / scrollable-body
//     layout; the Timeline detail panel uses block + overflow-y-auto.
//
// On mobile, panels render full-sheet (`fixed inset-0`) and don't use
// these constants — see each panel's own mobile branch.

export const DESKTOP_DETAIL_PANEL_CLASS =
  'absolute inset-y-0 right-0 w-1/3 z-20 border-l border-[rgba(30,25,20,0.08)] dark:border-white/10 bg-white dark:bg-[#0b0b0c]';

/**
 * Convenience: geometry + the most common interior layout (column with a
 * fixed header up top and a single scrollable body region inside).
 * Equivalent to `${DESKTOP_DETAIL_PANEL_CLASS} flex flex-col overflow-hidden`.
 */
export const DESKTOP_DETAIL_PANEL_FLEX = `${DESKTOP_DETAIL_PANEL_CLASS} flex flex-col overflow-hidden`;
