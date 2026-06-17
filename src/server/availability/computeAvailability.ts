import { getSupabaseServer } from '@/lib/supabaseServer';
import {
  refreshPropertyAvailability,
  type RefreshableProperty,
} from './refreshPropertyAvailability';

// computeAvailability — the single source of truth for "is this property free".
//
// It merges the two NATIVE sources (reservations ∪ calendar_blocks) into an
// OPAQUE busy/free signal over a date window. It deliberately reads our own
// tables, not a PMS API, so it works regardless of which PMS (Hostaway, Guesty,
// …) fills those tables — PMS specifics live behind refreshPropertyAvailability.
//
// Privacy: the returned shape carries ONLY dates + a busy/free verdict. No
// guest name, no reservation `kind` (so an owner stay is indistinguishable from
// a guest booking), no block note or source. A guest-facing caller can learn
// WHETHER dates are free, never WHY they aren't.
//
// THE ONE CORRECTNESS RULE (encoded once, here): a reservation occupies NIGHTS
// [check_in, check_out) — the checkout day itself is free, because the next
// guest can check in that same day (turnover). A calendar block occupies
// [start_date, end_date] INCLUSIVE. Treating them the same would falsely mark
// every checkout day busy. We expand each source into an explicit set of busy
// DATES honoring that distinction, then collapse to spans.

export interface AvailabilityWindow {
  /** Inclusive first date of the window, YYYY-MM-DD. */
  from: string;
  /** Inclusive last date of the window, YYYY-MM-DD. */
  to: string;
}

export interface BusySpan {
  /** Inclusive first busy date, YYYY-MM-DD. */
  from: string;
  /** Inclusive last busy date, YYYY-MM-DD. */
  to: string;
}

/**
 * A bookable opening expressed as a real stay: check in on `check_in`, check out
 * on `check_out`. Turnover-aware — `check_in` is the prior reservation's CHECKOUT
 * day (a new guest may arrive that day), and `check_out` is the next
 * reservation's CHECK-IN day. The handler computes these so the model never has
 * to derive free gaps from busy spans (an off-by-one it gets wrong).
 */
export interface AvailableWindow {
  check_in: string;
  check_out: string;
  /** Whole nights bookable in this opening (check_out − check_in). */
  nights: number;
}

export interface AvailabilityResult {
  property_id: string;
  window: AvailabilityWindow;
  /** True when no day in the window is occupied by a reservation or block. */
  fully_available: boolean;
  /** Contiguous spans of unavailable dates within the window. Opaque — no reason. */
  busy: BusySpan[];
  /**
   * Bookable openings within the window as ready-to-quote check-in→check-out
   * ranges. Already turnover-correct — present these verbatim rather than
   * computing gaps from `busy`.
   */
  free: AvailableWindow[];
  /** True when the underlying native data was just refreshed from the PMS. */
  fresh: boolean;
}

export interface ComputeAvailabilityOptions {
  /**
   * Skip the on-demand PMS refresh and read whatever the scheduled syncs last
   * wrote. Used by callers that already refreshed (e.g. a portfolio loop that
   * batches its own refresh) or where staleness is acceptable.
   */
  skipRefresh?: boolean;
}

type Supabase = ReturnType<typeof getSupabaseServer>;

// In-memory staleness gate. Keyed by property_id → last successful refresh ms.
// Best-effort: it lives on the warm serverless instance, so a burst of guest
// messages on one conversation (which hit the same instance) won't re-sync the
// same property repeatedly, while a cold start just pays one extra ~1-2s
// refresh. Not durable across instances by design — a durable column would be
// over-engineering for a "don't spam the PMS within a couple minutes" guard.
const REFRESH_TTL_MS = 120_000;
const lastRefreshedAt = new Map<string, number>();

function dateKeyToMs(d: string): number {
  return Date.parse(`${d}T00:00:00Z`);
}

function msToDateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function toDateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.length >= 10 ? value.slice(0, 10) : value;
}

/**
 * Compute availability for one property over [window.from, window.to]
 * (inclusive). Refreshes the property's native data from its PMS first, gated by
 * a short TTL, then merges reservations ∪ calendar_blocks. A refresh failure is
 * swallowed — we answer from existing native data and mark fresh=false rather
 * than fail the whole call (the caller can hedge).
 */
export async function computeAvailability(
  propertyId: string,
  window: AvailabilityWindow,
  opts: ComputeAvailabilityOptions = {},
  supabase: Supabase = getSupabaseServer(),
): Promise<AvailabilityResult> {
  const from = toDateOnly(window.from)!;
  const to = toDateOnly(window.to)!;

  // --- Freshness: refresh this one property unless told not to / recently done.
  let fresh = false;
  if (!opts.skipRefresh) {
    const last = lastRefreshedAt.get(propertyId) ?? 0;
    if (Date.now() - last >= REFRESH_TTL_MS) {
      const { data: propRow } = await supabase
        .from('properties')
        .select('id, hostaway_listing_id, is_active')
        .eq('id', propertyId)
        .maybeSingle();
      if (propRow) {
        try {
          const result = await refreshPropertyAvailability(
            propRow as RefreshableProperty,
            supabase,
          );
          if (result.refreshed) {
            fresh = true;
            lastRefreshedAt.set(propertyId, Date.now());
          }
        } catch (err) {
          // Graceful fallback: keep going with existing native data. Never let a
          // PMS hiccup (rate limit, 403, timeout) fail the availability answer.
          console.error('[computeAvailability] refresh failed; using cached native data', {
            propertyId,
            err: err instanceof Error ? err.message : err,
          });
        }
      }
    } else {
      // Within the TTL — data is already fresh from a refresh moments ago.
      fresh = true;
    }
  }

  // --- Pull both native sources, scoped to the overlap with the window.
  // Reservation overlap: check_in <= to AND check_out >= from.
  // Block overlap:       start_date <= to AND end_date >= from.
  const [resRes, blkRes] = await Promise.all([
    supabase
      .from('reservations')
      .select('check_in, check_out')
      .eq('property_id', propertyId)
      .lte('check_in', to)
      .gte('check_out', from),
    supabase
      .from('calendar_blocks')
      .select('start_date, end_date')
      .eq('property_id', propertyId)
      .lte('start_date', to)
      .gte('end_date', from),
  ]);
  if (resRes.error) throw new Error(`availability (reservations): ${resRes.error.message}`);
  if (blkRes.error) throw new Error(`availability (blocks): ${blkRes.error.message}`);

  const windowStartMs = dateKeyToMs(from);
  const windowEndMs = dateKeyToMs(to);
  const busyDays = new Set<number>();

  const markRange = (startMs: number, endMsInclusive: number) => {
    const lo = Math.max(startMs, windowStartMs);
    const hi = Math.min(endMsInclusive, windowEndMs);
    for (let d = lo; d <= hi; d += 86_400_000) busyDays.add(d);
  };

  // Reservations: busy NIGHTS are [check_in, check_out) → inclusive last busy
  // date is check_out - 1 day. Checkout day stays available (turnover).
  for (const r of (resRes.data ?? []) as Array<{ check_in: string | null; check_out: string | null }>) {
    const ci = toDateOnly(r.check_in);
    const co = toDateOnly(r.check_out);
    if (!ci || !co) continue;
    const ciMs = dateKeyToMs(ci);
    const lastNightMs = dateKeyToMs(co) - 86_400_000;
    if (!Number.isFinite(ciMs) || !Number.isFinite(lastNightMs)) continue;
    if (lastNightMs < ciMs) continue; // zero-night / same-day edge: occupies nothing
    markRange(ciMs, lastNightMs);
  }

  // Blocks: [start_date, end_date] fully inclusive.
  for (const b of (blkRes.data ?? []) as Array<{ start_date: string | null; end_date: string | null }>) {
    const s = toDateOnly(b.start_date);
    const e = toDateOnly(b.end_date);
    if (!s || !e) continue;
    const sMs = dateKeyToMs(s);
    const eMs = dateKeyToMs(e);
    if (!Number.isFinite(sMs) || !Number.isFinite(eMs)) continue;
    markRange(sMs, eMs);
  }

  // Collapse the busy-day set into contiguous inclusive spans.
  const sorted = Array.from(busyDays).sort((a, b) => a - b);
  const busy: BusySpan[] = [];
  for (const dayMs of sorted) {
    const last = busy[busy.length - 1];
    if (last && dateKeyToMs(last.to) + 86_400_000 === dayMs) {
      last.to = msToDateKey(dayMs);
    } else {
      busy.push({ from: msToDateKey(dayMs), to: msToDateKey(dayMs) });
    }
  }

  // Bookable openings: walk the window day by day, grouping contiguous FREE
  // nights. A run of free nights [A..B] becomes a stay check_in=A,
  // check_out=B+1 — the guest occupies nights A..B and departs the morning of
  // B+1 (which may be the next reservation's arrival day; turnover is fine).
  // Computing this here is the whole point: the model must never derive free
  // gaps from `busy` itself (it lands an off-by-one on the checkout day).
  const free: AvailableWindow[] = [];
  let runStart: number | null = null;
  let runEnd: number | null = null;
  for (let d = windowStartMs; d <= windowEndMs; d += 86_400_000) {
    if (!busyDays.has(d)) {
      if (runStart === null) runStart = d;
      runEnd = d;
    } else if (runStart !== null) {
      const checkoutMs = runEnd! + 86_400_000;
      free.push({
        check_in: msToDateKey(runStart),
        check_out: msToDateKey(checkoutMs),
        nights: Math.round((checkoutMs - runStart) / 86_400_000),
      });
      runStart = null;
    }
  }
  if (runStart !== null) {
    const checkoutMs = runEnd! + 86_400_000;
    free.push({
      check_in: msToDateKey(runStart),
      check_out: msToDateKey(checkoutMs),
      nights: Math.round((checkoutMs - runStart) / 86_400_000),
    });
  }

  return {
    property_id: propertyId,
    window: { from, to },
    fully_available: busy.length === 0,
    busy,
    free,
    fresh,
  };
}

/**
 * Convenience: is a specific requested stay bookable? A stay needs every NIGHT
 * from check_in up to (but not including) check_out to be free, so we probe the
 * window [check_in, check_out - 1]. Same-day / zero-night input is treated as
 * not a real stay → available=false is not implied; we return available=true
 * only if the (possibly empty) night window is clear.
 */
export async function isStayAvailable(
  propertyId: string,
  checkIn: string,
  checkOut: string,
  opts: ComputeAvailabilityOptions = {},
  supabase: Supabase = getSupabaseServer(),
): Promise<{ available: boolean; conflicts: BusySpan[]; fresh: boolean }> {
  const ci = toDateOnly(checkIn)!;
  const co = toDateOnly(checkOut)!;
  const lastNightMs = dateKeyToMs(co) - 86_400_000;
  const lastNight = msToDateKey(Math.max(lastNightMs, dateKeyToMs(ci)));
  const result = await computeAvailability(propertyId, { from: ci, to: lastNight }, opts, supabase);
  return { available: result.fully_available, conflicts: result.busy, fresh: result.fresh };
}
