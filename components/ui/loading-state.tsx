"use client";

import { cn } from "@/lib/utils";

/* ─────────────────────────────────────────────────────────
 * LoadingState — the app's one loading indicator.
 *
 * A 3×3 pixel grid animated by staggered opacity pulses
 * (keyframes `pixel-on` in globals.css). Variants:
 *   drive — square cells, chevron wavefront driving right;
 *           the 650ms cycle is shorter than the sweep, so
 *           two fronts are always in flight
 *   dots  — same wavefront, circular cells
 *   orbit — a comet lapping the grid perimeter
 *
 * Reduced motion freezes the grid to its dim state (the
 * `.pixel-cell` guard in globals.css).
 *
 * `PageLoading` is the centered wrapper for full-panel /
 * full-page loading areas.
 * ───────────────────────────────────────────────────────── */

type Variant = "drive" | "dots" | "orbit";

const CHEVRON = Array.from({ length: 9 }, (_, i) => {
  const r = Math.floor(i / 3);
  const c = i % 3;
  return (c + Math.abs(r - 1)) * 90;
});

const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3];
const ORBIT = Array.from({ length: 9 }, (_, i) => {
  const k = ORBIT_ORDER.indexOf(i);
  return k === -1 ? null : k * 110;
});

const PATTERNS: Record<Variant, { delays: (number | null)[]; dur: number; round: boolean }> = {
  drive: { delays: CHEVRON, dur: 650, round: false },
  dots: { delays: CHEVRON, dur: 650, round: true },
  orbit: { delays: ORBIT, dur: 950, round: false },
};

export function LoadingState({
  variant = "drive",
  size = 5,
  className,
}: {
  variant?: Variant;
  /** Cell size in px; the full grid is ~3.75× this. */
  size?: number;
  className?: string;
}) {
  const { delays, dur, round } = PATTERNS[variant];
  const gap = Math.max(1.5, size * 0.375);

  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn("grid w-fit", className)}
      style={{ gridTemplateColumns: `repeat(3, ${size}px)`, gap }}
    >
      {delays.map((d, i) => (
        <span
          key={i}
          aria-hidden
          className={cn("pixel-cell bg-foreground", round ? "rounded-full" : "rounded-[1px]")}
          style={{
            width: size,
            height: size,
            opacity: d === null ? 0.07 : 0.15,
            animation: d === null ? "none" : `pixel-on ${dur}ms ease-in-out ${d}ms infinite`,
          }}
        />
      ))}
    </span>
  );
}

export function PageLoading({
  variant = "drive",
  className,
}: {
  variant?: Variant;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-1 items-center justify-center py-16", className)}>
      <LoadingState variant={variant} size={6} />
    </div>
  );
}
