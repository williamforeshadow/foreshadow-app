import type { SupabaseClient } from '@supabase/supabase-js';
import {
  wallClockInTz,
  addDays,
  DEFAULT_TIMEZONE,
} from '@/src/lib/dates';
import type {
  PropertyOccupancy,
  PropertyOccupancyState,
} from '@/lib/types';

// occupancySnapshot — batched "is anyone in the unit RIGHT NOW, and until when".
//
// Sibling of computeAvailability, deliberately not a wrapper around it:
//   - BATCHED. computeAvailability answers one property; a task list needs
//     dozens in one payload, so this pulls both sources once for the whole set.
//   - NO PMS REFRESH. computeAvailability top-ups from Hostaway (~1-2s per
//     property) because a guest is waiting on a booking answer. This feeds a
//     display column, so it reads whatever the scheduled syncs last wrote — a
//     list render must never block on the PMS.
//   - MINUTE PRECISION, not day precision. This is the important one. Booking
//     availability is a question about NIGHTS, so computeAvailability can work
//     in whole dates. Turnover work is a question about HOURS: a same-day flip
//     checks one guest out at 10am and the next in at 4pm, and that six-hour
//     window is the entire job. Collapsing it to "occupied Jul 25 → Aug 3"
//     would hide every cleaning window in the calendar.
//   - THREE STATES, not busy/free. `blocked` (a calendar block with no
//     reservation) is split out from `occupied`, because to someone about to
//     walk into the unit those mean opposite things: occupied = a person is
//     inside; blocked = nobody's inside, it just isn't bookable.
//
// Reservations carry inconsistent time components in the DB (some midnight,
// some real check-in times), so the stored time is IGNORED and the org's
// configured default_check_in_time / default_check_out_time supply the clock —
// the same substitution get_property_turnovers makes when it windows tasks.
//
// Everything is compared as wall-clock "YYYY-MM-DDTHH:MM" strings in the
// property's own timezone, so ordering is plain lexicographic and DST never
// enters the math.

/** How far ahead to look for the next state change before giving up. */
const HORIZON_DAYS = 120;

/** Used only when the org has no operations_settings row at all. */
const FALLBACK_CHECK_IN_TIME = '16:00';
const FALLBACK_CHECK_OUT_TIME = '10:00';

interface PropertyRow {
  id: string;
  timezone: string | null;
}

interface ReservationRow {
  property_id: string | null;
  check_in: string | null;
  check_out: string | null;
}

interface BlockRow {
  property_id: string | null;
  start_date: string | null;
  end_date: string | null;
}

/**
 * A span during which the unit is not available to work in, as wall-clock keys.
 * Half-open: [start, end) — a guest checking out at 10:00 leaves the unit free
 * AT 10:00, so a 10:00 boundary belongs to the vacancy, not the stay.
 */
interface BusyInterval {
  start: string;
  end: string;
  kind: 'occupied' | 'blocked';
}

/** Reservations/blocks store timestamptz or date; we only ever want the day. */
function toDateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.length >= 10 ? value.slice(0, 10) : value;
}

/** '16:00:00' | '16:00' → '16:00'. Falsy/garbage falls back to `fallback`. */
function toClock(value: string | null | undefined, fallback: string): string {
  if (!value || value.length < 4) return fallback;
  const hhmm = value.slice(0, 5);
  return /^\d{2}:\d{2}$/.test(hhmm) ? hhmm : fallback;
}

export interface OccupancySnapshotOptions {
  /** Org whose operations_settings supply the default check-in/out clock. */
  orgId?: string | null;
  /** Override "now" as a wall-clock key (tests). Applied to every property. */
  asOf?: string;
  horizonDays?: number;
}

/**
 * Live occupancy for each of `propertyIds`, keyed by property id. Properties
 * with no reservations or blocks still get an entry (`vacant`); ids that don't
 * resolve to a property row are simply absent from the map, so callers can
 * treat "missing" and "unknown" identically.
 *
 * Throws on a DB error — callers rendering a display column should catch and
 * degrade to no column rather than failing the whole request.
 */
export async function getOccupancySnapshot(
  propertyIds: string[],
  supabase: SupabaseClient,
  opts: OccupancySnapshotOptions = {},
): Promise<Map<string, PropertyOccupancy>> {
  const ids = Array.from(new Set(propertyIds.filter(Boolean)));
  const result = new Map<string, PropertyOccupancy>();
  if (ids.length === 0) return result;

  const horizonDays = opts.horizonDays ?? HORIZON_DAYS;

  // --- Org clock + per-property timezone.
  // Resolution order matches opsToday: property.timezone → org default → UTC.
  const [settingsRes, propsRes] = await Promise.all([
    opts.orgId
      ? supabase
          .from('operations_settings')
          .select('default_check_in_time, default_check_out_time, default_timezone')
          .eq('org_id', opts.orgId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase.from('properties').select('id, timezone').in('id', ids),
  ]);
  if (propsRes.error) throw new Error(`occupancy (properties): ${propsRes.error.message}`);

  const settings = settingsRes.data as {
    default_check_in_time: string | null;
    default_check_out_time: string | null;
    default_timezone: string | null;
  } | null;
  const checkInClock = toClock(settings?.default_check_in_time, FALLBACK_CHECK_IN_TIME);
  const checkOutClock = toClock(settings?.default_check_out_time, FALLBACK_CHECK_OUT_TIME);
  const orgTimezone = settings?.default_timezone || DEFAULT_TIMEZONE;

  const now = new Date();
  const timezoneByProperty = new Map<string, string>();
  const nowByProperty = new Map<string, string>();
  for (const p of (propsRes.data ?? []) as PropertyRow[]) {
    const tz = p.timezone || orgTimezone;
    timezoneByProperty.set(p.id, tz);
    nowByProperty.set(p.id, opts.asOf ?? wallClockInTz(tz, now));
  }
  if (nowByProperty.size === 0) return result;

  // Date bounds for the queries. Timezones shift each property's "today" by at
  // most a day, so widen by one on each side and let the interval math be exact.
  const nowKeys = Array.from(nowByProperty.values()).sort();
  const queryFrom = addDays(nowKeys[0].slice(0, 10), -1);
  const queryTo = addDays(nowKeys[nowKeys.length - 1].slice(0, 10), horizonDays);

  // --- Pull both native sources once for the whole set.
  const knownIds = Array.from(nowByProperty.keys());
  const [resRes, blkRes] = await Promise.all([
    supabase
      .from('reservations')
      .select('property_id, check_in, check_out')
      .in('property_id', knownIds)
      .lte('check_in', queryTo)
      .gte('check_out', queryFrom),
    supabase
      .from('calendar_blocks')
      .select('property_id, start_date, end_date')
      .in('property_id', knownIds)
      .lte('start_date', queryTo)
      .gte('end_date', queryFrom),
  ]);
  if (resRes.error) throw new Error(`occupancy (reservations): ${resRes.error.message}`);
  if (blkRes.error) throw new Error(`occupancy (blocks): ${blkRes.error.message}`);

  const intervalsByProperty = new Map<string, BusyInterval[]>();
  const push = (propertyId: string, interval: BusyInterval) => {
    if (interval.end <= interval.start) return; // zero-length / bad data
    const list = intervalsByProperty.get(propertyId);
    if (list) list.push(interval);
    else intervalsByProperty.set(propertyId, [interval]);
  };

  // A stay runs from check-in time on the arrival day to check-out time on the
  // departure day. A one-night booking is 4pm → 10am next morning; a same-day
  // (zero-night) row collapses to nothing and is dropped by `push`.
  for (const r of (resRes.data ?? []) as ReservationRow[]) {
    if (!r.property_id) continue;
    const ci = toDateOnly(r.check_in);
    const co = toDateOnly(r.check_out);
    if (!ci || !co) continue;
    push(r.property_id, {
      start: `${ci}T${checkInClock}`,
      end: `${co}T${checkOutClock}`,
      kind: 'occupied',
    });
  }

  // Blocks are whole calendar days, [start_date, end_date] inclusive — so the
  // half-open end is midnight at the START of the following day.
  for (const b of (blkRes.data ?? []) as BlockRow[]) {
    if (!b.property_id) continue;
    const s = toDateOnly(b.start_date);
    const e = toDateOnly(b.end_date);
    if (!s || !e || e < s) continue;
    push(b.property_id, {
      start: `${s}T00:00`,
      end: `${addDays(e, 1)}T00:00`,
      kind: 'blocked',
    });
  }

  // --- Resolve each property against its own "now".
  for (const [propertyId, nowKey] of nowByProperty) {
    const timezone = timezoneByProperty.get(propertyId) ?? orgTimezone;
    const horizonEnd = `${addDays(nowKey.slice(0, 10), horizonDays)}T00:00`;
    const intervals = (intervalsByProperty.get(propertyId) ?? []).sort(
      (a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end),
    );

    // Intervals covering this instant. Half-open, so a stay ending exactly now
    // has already released the unit.
    const covering = intervals.filter((i) => i.start <= nowKey && nowKey < i.end);
    // A reservation wins over a block on the same instant — someone physically
    // in the unit is the more important fact.
    const status: PropertyOccupancyState = covering.some((i) => i.kind === 'occupied')
      ? 'occupied'
      : covering.length > 0
        ? 'blocked'
        : 'vacant';

    let until: string | null = null;
    let untilKind: PropertyOccupancy['until_kind'] = null;

    if (status === 'vacant') {
      // Next arrival of any kind. `intervals` is sorted, so the first one
      // starting after now is the soonest.
      const next = intervals.find((i) => i.start > nowKey);
      if (next && next.start <= horizonEnd) {
        until = next.start;
        untilKind = next.kind === 'occupied' ? 'booked' : 'blocked';
      }
    } else {
      // The moment the unit actually empties. Extend only through intervals
      // that touch or overlap the current one — a same-day flip has a real gap
      // between checkout and the next arrival, so the walk STOPS at checkout
      // and reports that window rather than swallowing it.
      let end = covering.reduce((max, i) => (i.end > max ? i.end : max), covering[0].end);
      for (const i of intervals) {
        if (i.start > end) break; // sorted: nothing later can touch either
        if (i.end > end) end = i.end;
      }
      until = end;
      untilKind = 'free';
    }

    result.set(propertyId, {
      status,
      until,
      until_kind: untilKind,
      as_of: nowKey,
      timezone,
    });
  }

  return result;
}

/**
 * Attach an `occupancy` field to every row of a task payload, keyed off each
 * row's `property_id`. Rows without a property carry null — there's nothing to
 * be occupied.
 *
 * Non-fatal by design: occupancy is a display affordance, so a failure here
 * leaves every row with `occupancy: null` (an empty column) rather than failing
 * the whole request. Shared by the list endpoints so they can't drift.
 */
export async function attachOccupancy<T extends { property_id?: string | null }>(
  rows: T[],
  supabase: SupabaseClient,
  opts: OccupancySnapshotOptions = {},
): Promise<Array<T & { occupancy: PropertyOccupancy | null }>> {
  const propertyIds = Array.from(
    new Set(rows.map((r) => r.property_id).filter((id): id is string => !!id)),
  );

  let snapshot = new Map<string, PropertyOccupancy>();
  if (propertyIds.length > 0) {
    try {
      snapshot = await getOccupancySnapshot(propertyIds, supabase, opts);
    } catch (err) {
      console.error(
        '[attachOccupancy] failed; rendering without occupancy',
        err instanceof Error ? err.message : err,
      );
    }
  }

  return rows.map((row) => ({
    ...row,
    occupancy: row.property_id ? snapshot.get(row.property_id) ?? null : null,
  }));
}
