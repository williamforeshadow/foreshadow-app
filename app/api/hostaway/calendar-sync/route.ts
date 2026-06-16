import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { fetchListingCalendar } from '@/lib/hostaway';

// Calendar sync — pulls manual/maintenance BLOCKS (not reservations) from each
// listing's Hostaway calendar into `calendar_blocks` so they show on the ops
// schedule. Owner stays and guest bookings come through the reservation sync
// (status 'reserved'); this sync only cares about status 'blocked' days.
//
// Separate from /api/hostaway/sync (and on its own cron) so the per-listing
// calendar fetches don't eat into the reservation sync's time budget. No
// automations fire here — blocks are availability data, not bookings.

export const maxDuration = 120;

// How far forward we keep block availability fresh. One calendar call per
// listing covers the whole window; 10–50 listings per operator = trivial.
const HORIZON_DAYS = 365;

interface BlockRange {
  start_date: string;
  end_date: string;
  note: string | null;
}

/** True when `next` is the calendar day immediately after `prev` (YYYY-MM-DD). */
function isNextDay(prev: string, next: string): boolean {
  const p = Date.parse(`${prev}T00:00:00Z`);
  const n = Date.parse(`${next}T00:00:00Z`);
  return Number.isFinite(p) && Number.isFinite(n) && n - p === 86_400_000;
}

/**
 * Collapse a listing's calendar days into contiguous manual-block ranges.
 * A manual/maintenance block: Hostaway marks the day 'blocked' (not 'reserved'
 * or 'available') and no reservation covers it. Owner stays / guest bookings
 * are 'reserved', so they're excluded here — they live in `reservations`.
 */
function deriveBlockRanges(days: Array<Record<string, any>>): BlockRange[] {
  const blocked = days
    .filter(
      (d) =>
        String(d.status) === 'blocked' &&
        (!Array.isArray(d.reservations) || d.reservations.length === 0) &&
        typeof d.date === 'string',
    )
    .map((d) => ({ date: d.date as string, note: (d.note as string | null) ?? null }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const ranges: BlockRange[] = [];
  for (const day of blocked) {
    const last = ranges[ranges.length - 1];
    if (last && isNextDay(last.end_date, day.date)) {
      last.end_date = day.date;
      if (!last.note && day.note) last.note = day.note;
    } else {
      ranges.push({ start_date: day.date, end_date: day.date, note: day.note });
    }
  }
  return ranges;
}

export async function POST() {
  try {
    console.log('[Calendar Sync] Starting…');
    const supabase = getSupabaseServer();

    // Active, Hostaway-linked properties only. Inactive properties are frozen
    // (same rule as the reservation sync); unlinked listings never materialize.
    const { data: props, error: propsErr } = await supabase
      .from('properties')
      .select('id, hostaway_listing_id, is_active');
    if (propsErr) {
      return NextResponse.json({ error: propsErr.message }, { status: 500 });
    }
    type PropRow = { id: string; hostaway_listing_id: number | null; is_active: boolean | null };
    const targets = ((props || []) as PropRow[]).filter(
      (p) => p.hostaway_listing_id != null && p.is_active !== false,
    );

    const today = new Date().toISOString().slice(0, 10);
    const windowEnd = new Date(Date.now() + HORIZON_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);

    let propertiesProcessed = 0;
    let blocksWritten = 0;
    const errors: string[] = [];

    for (const p of targets) {
      try {
        const days = await fetchListingCalendar(
          p.hostaway_listing_id as number,
          today,
          windowEnd,
        );
        const ranges = deriveBlockRanges(days);

        // Reconcile: replace this property's hostaway blocks that overlap the
        // refreshed forward window, then insert the freshly-derived ranges.
        // Past blocks (end_date < today) are left untouched — same current+future
        // scope as the reservation sync. Far-future blocks beyond the window are
        // left alone too (start_date > windowEnd).
        const { error: delErr } = await supabase
          .from('calendar_blocks')
          .delete()
          .eq('property_id', p.id)
          .eq('source', 'hostaway')
          .gte('end_date', today)
          .lte('start_date', windowEnd);
        if (delErr) {
          errors.push(`Delete (${p.id}): ${delErr.message}`);
          continue;
        }

        if (ranges.length) {
          const rows = ranges.map((r) => ({
            property_id: p.id,
            source: 'hostaway',
            start_date: r.start_date,
            end_date: r.end_date,
            note: r.note,
            updated_at: new Date().toISOString(),
          }));
          const { error: insErr } = await supabase.from('calendar_blocks').insert(rows);
          if (insErr) {
            errors.push(`Insert (${p.id}): ${insErr.message}`);
            continue;
          }
          blocksWritten += rows.length;
        }
        propertiesProcessed += 1;
      } catch (err: any) {
        errors.push(`Listing ${p.hostaway_listing_id}: ${err?.message || 'failed'}`);
      }
      // Rate-limit friendly between listings.
      await new Promise((r) => setTimeout(r, 600));
    }

    const result = {
      success: true,
      properties_processed: propertiesProcessed,
      blocks_written: blocksWritten,
      errors: errors.length ? errors : undefined,
    };
    console.log('[Calendar Sync] Complete:', JSON.stringify(result));
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[Calendar Sync] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// GET for easy browser/manual trigger, mirroring /api/hostaway/sync.
export async function GET() {
  return POST();
}
