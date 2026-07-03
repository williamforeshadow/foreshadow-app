import { getSupabaseServer } from '@/lib/supabaseServer';
import { fetchReservationsForListing, fetchListingCalendar } from '@/lib/hostaway';
import { getHostawayCredsForOrg } from '@/lib/pmsIntegrations';

// refreshPropertyAvailability — on-demand, SINGLE-PROPERTY freshness for the
// availability path. The scheduled portfolio crons (app/api/hostaway/sync +
// calendar-sync) keep everything roughly current every few hours; this is the
// targeted top-up so a guest-facing availability answer reflects the latest
// bookings/blocks for the ONE property in question, without paying for a full
// portfolio sweep.
//
// PMS-agnostic by intent: computeAvailability calls refreshPropertyAvailability
// and never knows which PMS is behind the data. Today the only adapter is
// Hostaway (dispatched on hostaway_listing_id); a property with no Hostaway
// linkage simply isn't refreshed here (a future adapter handles its own).
//
// Two differences from the cron path, both deliberate:
//   1. AVAILABILITY-ONLY: inserting a freshly-discovered reservation here does
//      NOT fire turnover automations. Automations are application-level
//      (runAutomationsForRowChange), never a DB trigger, so simply not calling
//      the runner is sufficient. A guest message is the wrong trigger for
//      "new booking → create cleaning task" — the scheduled sync owns that.
//   2. NO cancellation deletes. A reservation cancelled since the last cron
//      run still shows here as busy → we'd over-report unavailability (safe:
//      we'd hedge, never double-book). Deleting reservations is the cron's job;
//      keeping this path insert/update-only makes it simple and low-risk.

const HORIZON_DAYS = 365;

export interface RefreshableProperty {
  id: string;
  org_id: string;
  hostaway_listing_id: number | null;
  is_active: boolean | null;
}

export interface RefreshResult {
  refreshed: boolean;
  /** Why a refresh was skipped, when it was. */
  skipped_reason?: 'no_pms_link' | 'inactive';
}

/** True when `next` is the calendar day immediately after `prev` (YYYY-MM-DD). */
function isNextDay(prev: string, next: string): boolean {
  const p = Date.parse(`${prev}T00:00:00Z`);
  const n = Date.parse(`${next}T00:00:00Z`);
  return Number.isFinite(p) && Number.isFinite(n) && n - p === 86_400_000;
}

interface BlockRange {
  start_date: string;
  end_date: string;
  note: string | null;
}

// Collapse a listing's calendar days into contiguous manual-block ranges.
// Mirrors app/api/hostaway/calendar-sync's deriveBlockRanges: a block is a day
// Hostaway marked 'blocked' with no reservation behind it (reserved days are
// guest bookings / owner stays and live in `reservations`).
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

type Supabase = ReturnType<typeof getSupabaseServer>;

/**
 * Refresh one property's reservations + calendar blocks from its PMS. Throws on
 * a PMS/DB error so the caller (computeAvailability) can decide whether to fall
 * back to existing native data. Skips (no throw) when the property has no PMS
 * link or is inactive.
 */
export async function refreshPropertyAvailability(
  property: RefreshableProperty,
  supabase: Supabase = getSupabaseServer(),
): Promise<RefreshResult> {
  if (property.is_active === false) {
    return { refreshed: false, skipped_reason: 'inactive' };
  }
  // Only the Hostaway adapter exists today. No linkage → nothing to refresh
  // (the native tables still hold whatever the last sync wrote).
  if (property.hostaway_listing_id == null) {
    return { refreshed: false, skipped_reason: 'no_pms_link' };
  }
  const listingId = property.hostaway_listing_id;
  const creds = await getHostawayCredsForOrg(property.org_id);

  const today = new Date().toISOString().slice(0, 10);
  const windowEnd = new Date(Date.now() + HORIZON_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);

  // --- Reservations: insert new / update changed, NO deletes, NO automations.
  const fresh = await fetchReservationsForListing(creds, listingId, today);

  const { data: existingRows, error: exErr } = await supabase
    .from('reservations')
    .select('id, hostaway_reservation_id, check_in, check_out, guest_name, kind')
    .eq('property_id', property.id)
    .not('hostaway_reservation_id', 'is', null);
  if (exErr) throw new Error(`availability refresh (reservations read): ${exErr.message}`);

  const existingByHaId = new Map<
    number,
    { id: string; check_in: string; check_out: string; guest_name: string; kind: string }
  >();
  for (const r of (existingRows ?? []) as Array<{
    id: string;
    hostaway_reservation_id: number;
    check_in: string;
    check_out: string;
    guest_name: string;
    kind: string;
  }>) {
    existingByHaId.set(r.hostaway_reservation_id, {
      id: r.id,
      check_in: r.check_in,
      check_out: r.check_out,
      guest_name: r.guest_name,
      kind: r.kind ?? 'guest_booking',
    });
  }

  const nowIso = new Date().toISOString();
  const newRows: Array<Record<string, unknown>> = [];
  for (const r of fresh) {
    const kind: 'guest_booking' | 'owner_stay' =
      (r.status || '').toLowerCase() === 'ownerstay' ? 'owner_stay' : 'guest_booking';
    const guestName =
      [r.guestFirstName, r.guestLastName].filter(Boolean).join(' ') ||
      (kind === 'owner_stay' ? 'Owner Stay' : 'Unknown Guest');
    const existing = existingByHaId.get(r.id);

    if (!existing) {
      newRows.push({
        hostaway_reservation_id: r.id,
        property_id: property.id,
        property_name: r.listingName || `Listing ${r.listingMapId}`,
        guest_name: guestName,
        check_in: r.arrivalDate,
        check_out: r.departureDate,
        channel: r.channelName ?? null,
        kind,
        updated_at: nowIso,
        org_id: property.org_id,
      });
    } else {
      const existCheckIn = existing.check_in?.slice(0, 10) || '';
      const existCheckOut = existing.check_out?.slice(0, 10) || '';
      const changed =
        existCheckIn !== r.arrivalDate ||
        existCheckOut !== r.departureDate ||
        existing.guest_name !== guestName ||
        existing.kind !== kind;
      if (changed) {
        const { error: updErr } = await supabase
          .from('reservations')
          .update({
            guest_name: guestName,
            check_in: r.arrivalDate,
            check_out: r.departureDate,
            kind,
            updated_at: nowIso,
          })
          .eq('id', existing.id);
        if (updErr) throw new Error(`availability refresh (reservation update): ${updErr.message}`);
      }
    }
  }
  if (newRows.length > 0) {
    // No .select()/automation fire — availability-only insert.
    const { error: insErr } = await supabase.from('reservations').insert(newRows);
    if (insErr) throw new Error(`availability refresh (reservation insert): ${insErr.message}`);
  }

  // --- Blocks: reconcile this property's hostaway blocks in the forward window
  // (delete + replace), same scope as the calendar-sync cron.
  const days = await fetchListingCalendar(creds, listingId, today, windowEnd);
  const ranges = deriveBlockRanges(days);

  const { error: delErr } = await supabase
    .from('calendar_blocks')
    .delete()
    .eq('property_id', property.id)
    .eq('source', 'hostaway')
    .gte('end_date', today)
    .lte('start_date', windowEnd);
  if (delErr) throw new Error(`availability refresh (blocks delete): ${delErr.message}`);

  if (ranges.length > 0) {
    const blockRows = ranges.map((r) => ({
      property_id: property.id,
      source: 'hostaway',
      start_date: r.start_date,
      end_date: r.end_date,
      note: r.note,
      updated_at: nowIso,
      org_id: property.org_id,
    }));
    const { error: blkInsErr } = await supabase.from('calendar_blocks').insert(blockRows);
    if (blkInsErr) throw new Error(`availability refresh (blocks insert): ${blkInsErr.message}`);
  }

  return { refreshed: true };
}
