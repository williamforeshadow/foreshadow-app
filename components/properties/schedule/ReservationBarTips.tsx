'use client';

import React from 'react';
import {
  RESERVATION_BAR_DIAGONAL_PX,
  RESERVATION_BAR_TIP_EDGE_PX,
} from '@/components/properties/schedule/scheduleDates';

/**
 * The solid line that caps a reservation bar's slanted tip — the hard edge the
 * tip gradient (see reservationBarTipShading) runs off at the check-in start
 * and the check-out end.
 *
 * Why a clipped child rather than another background layer: the edge is
 * DIAGONAL, and a background gradient's stops are measured along a straight
 * gradient line, so hugging the slant with one would mean deriving both an
 * angle and a start offset from the bar's height — which differs per surface
 * (22px in the schedule window, 24px in the month grid and mobile, auto in the
 * day panel). A child with its own clip-path expresses the band in the same
 * terms as the bar's own polygon and uses `100%` for the vertical, so it tracks
 * any height for free.
 *
 * Both ends use the SAME polygon: the bar is a parallelogram, so its two edges
 * lean identically — only the anchor side changes.
 *
 * Render inside the bar element (which is already positioned and clipped, so
 * these stay inside the silhouette). Pass `left`/`right` on the same rule as
 * the gradient: real check-in / check-out edges only, never a flush edge that
 * merely runs off the visible range.
 */
export function ReservationBarTips({
  left,
  right,
  diagonalPx = RESERVATION_BAR_DIAGONAL_PX,
}: {
  left: boolean;
  right: boolean;
  diagonalPx?: number;
}) {
  if (!left && !right) return null;

  const t = RESERVATION_BAR_TIP_EDGE_PX;
  const width = diagonalPx + t;
  const clipPath = `polygon(${diagonalPx}px 0, ${diagonalPx + t}px 0, ${t}px 100%, 0 100%)`;
  const base: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width,
    background: 'var(--res-bar-tip-edge)',
    clipPath,
    pointerEvents: 'none',
  };

  return (
    <>
      {left && <div aria-hidden style={{ ...base, left: 0 }} />}
      {right && <div aria-hidden style={{ ...base, right: 0 }} />}
    </>
  );
}
