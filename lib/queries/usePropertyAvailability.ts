'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { qk } from './keys';
import { fetchJson } from './fetchJson';

// Shared, cached per-month occupancy for one property: the reservations and
// calendar blocks that the task date picker paints behind its day cells.
//
// Deliberately NOT the full /schedule payload — `include=availability` tells
// the route to skip the turnover_tasks query and its four joins, which the
// picker never reads. That's most of the round-trip.
//
// Cached under React Query so the picker paints from cache on reopen instead
// of refetching. The chip row warms this the moment a task panel renders (see
// useWarmPropertyAvailability), so by the time the calendar is on screen the
// purple is already there rather than a beat behind it.

export interface AvailabilityReservation {
  id: string;
  check_in: string;
  check_out: string;
  /** 'guest_booking' | 'owner_stay' — owner stays paint amber, not purple. */
  kind?: string | null;
}

export interface AvailabilityBlock {
  id: string;
  start_date: string;
  /** Inclusive last blocked day. */
  end_date: string;
  note?: string | null;
}

export interface PropertyAvailability {
  reservations: AvailabilityReservation[];
  blocks: AvailabilityBlock[];
}

const EMPTY: PropertyAvailability = { reservations: [], blocks: [] };

async function fetchAvailability(
  propertyId: string,
  year: number,
  month: number
): Promise<PropertyAvailability> {
  const json = await fetchJson<Partial<PropertyAvailability>>(
    `/api/properties/${propertyId}/schedule?year=${year}&month=${month}&include=availability`
  );
  return {
    reservations: json.reservations ?? [],
    blocks: json.blocks ?? [],
  };
}

/**
 * Occupancy for the calendar month containing `month`.
 *
 * The route already widens its window by ±7 days, so the adjacent-month cells
 * of a 6-week grid are covered by the same fetch.
 */
export function usePropertyAvailabilityMonth(
  propertyId: string | null,
  month: Date,
  { enabled = true }: { enabled?: boolean } = {}
) {
  const year = month.getFullYear();
  const monthNum = month.getMonth() + 1;

  const query = useQuery({
    queryKey: qk.propertyAvailabilityMonth(propertyId ?? '', year, monthNum),
    queryFn: () => fetchAvailability(propertyId!, year, monthNum),
    enabled: enabled && !!propertyId,
    // Occupancy moves on PMS sync cadence, not by the second. A minute of
    // staleness keeps month paging instant without serving stale purple.
    staleTime: 60_000,
  });

  return {
    availability: query.data ?? EMPTY,
    loading: query.isLoading,
  };
}

/**
 * Warm the cache for the month a date picker will open on, without rendering
 * anything. Call from the surface that owns the Schedule chip: the picker
 * itself is unmounted until its popover opens, so a fetch started there can
 * only ever begin after the user is already looking at an empty calendar.
 *
 * `anchor` is the currently-scheduled date (YYYY-MM-DD) or '' / null when
 * unset — the picker opens on that month, falling back to the current month.
 */
export function useWarmPropertyAvailability(
  propertyId: string | null,
  anchor: string | null | undefined
) {
  const month = useMemo(() => monthAnchor(anchor), [anchor]);
  usePropertyAvailabilityMonth(propertyId, month);
}

/** The month a picker anchored at `value` will first display. */
export function monthAnchor(value: string | null | undefined): Date {
  if (value) {
    const y = Number(value.slice(0, 4));
    const m = Number(value.slice(5, 7));
    if (Number.isFinite(y) && Number.isFinite(m) && m >= 1 && m <= 12) {
      return new Date(y, m - 1, 1);
    }
  }
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}
