'use client';

import React from 'react';
import { Key } from 'lucide-react';
import { useReservationViewer } from '@/lib/reservationViewerContext';

// Single source of truth for the key icon shown next to reservation-bound
// task titles (and the "Scheduled" labels in the generic task detail
// panels). Behavior:
//
//   - When `reservationId` is null/undefined we render nothing — keeps
//     callsites simple (`<KeyAffordance reservationId={item.reservation_id}/>`).
//   - When the icon's reservation matches the nearest
//     <ReservationContextOverride> (i.e. we're already inside that
//     reservation's panel), we render a static <span> — no click, no
//     hover affordance — to avoid re-opening the same panel on top of itself.
//   - Otherwise we render a real <button> that opens the global Reservation
//     Detail drawer for `reservationId`. The button uses
//     `e.stopPropagation()` so it won't bubble into a clickable parent
//     (task row, etc.) — parents that wrap their children in a clickable
//     button must convert to <div role="button"> to keep the HTML valid.
//
// Visual:
//   - 12px icon, neutral-400 / dark:#66645f
//   - On hover (clickable variant), a subtle rounded shaded square
//     (neutral-200/60 light, white/15 dark) signals it's selectable.

interface KeyAffordanceProps {
  reservationId: string | null | undefined;
  /** Tooltip / aria-label. Defaults match each surface's previous text. */
  tooltip?: string;
  /** Pixel size of the inner Key icon. Defaults to 12. */
  size?: number;
  /** Tailwind text color classes for the icon glyph itself. */
  iconClassName?: string;
}

export function KeyAffordance({
  reservationId,
  tooltip = 'Scheduled relative to reservation',
  size = 12,
  iconClassName = 'text-neutral-400 dark:text-[#66645f]',
}: KeyAffordanceProps) {
  const { open, currentReservationId } = useReservationViewer();

  if (!reservationId) return null;

  const isCurrent = currentReservationId === reservationId;

  if (isCurrent) {
    return (
      <span
        className="inline-flex shrink-0 p-0.5"
        title={tooltip}
        aria-label={tooltip}
      >
        <Key
          style={{ width: size, height: size }}
          className={iconClassName}
        />
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        open(reservationId);
      }}
      onMouseDown={(e) => e.stopPropagation()}
      className="inline-flex shrink-0 p-0.5 rounded-[4px] hover:bg-neutral-200/70 dark:hover:bg-white/15 transition-colors"
      title={tooltip}
      aria-label={tooltip}
    >
      <Key style={{ width: size, height: size }} className={iconClassName} />
    </button>
  );
}
