import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { fetchListings, fetchReservations } from '@/lib/hostaway';

// Allow enough time for paginated Hostaway fetches + batched inserts
export const maxDuration = 120;

export async function POST() {
  try {
    console.log('[Hostaway Sync] Starting…');
    const supabase = getSupabaseServer();

    // 1. Sync listings → properties
    //
    // We split INSERT vs UPDATE so user-customized `properties.name` (the
    // "property code") is preserved across syncs. Hostaway's name snapshot
    // lives in `hostaway_name` and is the only name-related field we ever
    // overwrite for existing rows.
    const listingsMap = await fetchListings();
    console.log(`[Hostaway Sync] Fetched ${listingsMap.size} listings`);

    const { data: existingPropsRaw } = await supabase
      .from('properties')
      .select('id, hostaway_listing_id');

    const existingPropIdMap = new Map<number, string>();
    for (const p of existingPropsRaw || []) {
      if (p.hostaway_listing_id != null) {
        existingPropIdMap.set(p.hostaway_listing_id, p.id);
      }
    }

    const nowIso = new Date().toISOString();
    const newListingRows: Array<{
      hostaway_listing_id: number;
      name: string;
      hostaway_name: string;
      updated_at: string;
    }> = [];
    const existingListingUpdates: Array<{
      hostaway_listing_id: number;
      hostaway_name: string;
    }> = [];

    for (const [listingId, listingName] of listingsMap.entries()) {
      if (existingPropIdMap.has(listingId)) {
        existingListingUpdates.push({
          hostaway_listing_id: listingId,
          hostaway_name: listingName,
        });
      } else {
        newListingRows.push({
          hostaway_listing_id: listingId,
          name: listingName,
          hostaway_name: listingName,
          updated_at: nowIso,
        });
      }
    }

    // INSERT brand-new listings (populate both name + hostaway_name)
    if (newListingRows.length > 0) {
      const { error: insertPropErr } = await supabase
        .from('properties')
        .insert(newListingRows);
      if (insertPropErr) {
        console.error('[Hostaway Sync] property insert error:', insertPropErr.message);
      }
    }

    // UPDATE existing listings — only touch hostaway_name, never overwrite `name`
    for (const row of existingListingUpdates) {
      const { error: updatePropErr } = await supabase
        .from('properties')
        .update({ hostaway_name: row.hostaway_name, updated_at: nowIso })
        .eq('hostaway_listing_id', row.hostaway_listing_id);
      if (updatePropErr) {
        console.error('[Hostaway Sync] property update error:', updatePropErr.message);
      }
    }

    // Refresh the hostaway_listing_id → property uuid lookup to include newly-inserted rows
    const { data: props } = await supabase
      .from('properties')
      .select('id, hostaway_listing_id');

    const propIdMap = new Map<number, string>();
    for (const p of props || []) propIdMap.set(p.hostaway_listing_id, p.id);

    // 2. Fetch current + future reservations from Hostaway
    const today = new Date().toISOString().split('T')[0];
    const reservations = await fetchReservations(today);
    console.log(`[Hostaway Sync] Fetched ${reservations.length} reservations from Hostaway`);

    // 3. Load existing Hostaway reservation IDs from Supabase so we know what's new
    const { data: existingRows } = await supabase
      .from('reservations')
      .select('id, hostaway_reservation_id, check_in, check_out, guest_name')
      .not('hostaway_reservation_id', 'is', null);

    const existingMap = new Map<number, {
      id: string;
      check_in: string;
      check_out: string;
      guest_name: string;
    }>();
    for (const row of existingRows || []) {
      existingMap.set(row.hostaway_reservation_id, {
        id: row.id,
        check_in: row.check_in,
        check_out: row.check_out,
        guest_name: row.guest_name,
      });
    }

    const BATCH = 20;
    let inserted = 0;
    let updated = 0;
    const errors: string[] = [];

    // Collect all Hostaway reservation IDs from the fresh pull (for cancellation detection)
    const freshHostawayIds = new Set<number>();

    // Separate new vs existing reservations
    const newRows: any[] = [];
    const updateRows: any[] = [];

    for (const r of reservations) {
      freshHostawayIds.add(r.id);

      const propertyName =
        r.listingName ||
        listingsMap.get(r.listingMapId) ||
        `Listing ${r.listingMapId}`;
      const guestName =
        [r.guestFirstName, r.guestLastName].filter(Boolean).join(' ') ||
        'Unknown Guest';

      const existing = existingMap.get(r.id);

      if (!existing) {
        // Brand new reservation → INSERT (will trigger automations correctly)
        newRows.push({
          hostaway_reservation_id: r.id,
          property_id: propIdMap.get(r.listingMapId) || null,
          property_name: propertyName,
          guest_name: guestName,
          check_in: r.arrivalDate,
          check_out: r.departureDate,
          updated_at: new Date().toISOString(),
        });
      } else {
        // Already exists — only update if dates or guest actually changed
        // Normalize dates to YYYY-MM-DD for comparison (Supabase stores ISO timestamps)
        const existCheckIn = existing.check_in?.slice(0, 10) || '';
        const existCheckOut = existing.check_out?.slice(0, 10) || '';
        const haChanges =
          existCheckIn !== r.arrivalDate ||
          existCheckOut !== r.departureDate ||
          existing.guest_name !== guestName;

        if (haChanges) {
          updateRows.push({
            supabaseId: existing.id,
            guest_name: guestName,
            check_in: r.arrivalDate,
            check_out: r.departureDate,
          });
        }
      }
    }

    // 4a. INSERT new reservations in batches (triggers fire = tasks created)
    for (let i = 0; i < newRows.length; i += BATCH) {
      const batch = newRows.slice(i, i + BATCH);
      const { error } = await supabase.from('reservations').insert(batch);

      if (error) errors.push(`Insert batch error: ${error.message}`);
      else inserted += batch.length;

      if (i + BATCH < newRows.length) {
        await new Promise((r) => setTimeout(r, 1200));
      }
    }

    // 4b. UPDATE existing reservations individually (no INSERT trigger re-fire)
    for (const row of updateRows) {
      const { error } = await supabase
        .from('reservations')
        .update({
          guest_name: row.guest_name,
          check_in: row.check_in,
          check_out: row.check_out,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.supabaseId);

      if (error) errors.push(`Update error: ${error.message}`);
      else updated++;
    }

    console.log(`[Hostaway Sync] Inserted ${inserted} new, updated ${updated} existing`);

    // 5. Refresh hostaway_name snapshots from reservation payload
    //
    // Hostaway returns `listingName` on each reservation; we treat that as the
    // authoritative Hostaway-side name and push it to `properties.hostaway_name`.
    // We never touch `properties.name` here — that's user-controlled.
    const nameCorrections = new Map<number, string>();
    for (const r of reservations) {
      if (r.listingMapId && r.listingName) {
        nameCorrections.set(r.listingMapId, r.listingName);
      }
    }
    for (const [listingId, hostawayName] of nameCorrections.entries()) {
      const { error: correctionErr } = await supabase
        .from('properties')
        .update({ hostaway_name: hostawayName, updated_at: nowIso })
        .eq('hostaway_listing_id', listingId);
      if (correctionErr) {
        console.error('[Hostaway Sync] name correction error:', correctionErr.message);
      }
    }

    // 6. Remove cancelled reservations
    //    Only delete current/future Hostaway reservations that are no longer
    //    in the fresh pull (cancelled/declined). Past reservations stay forever.
    let removed = 0;

    const futureExisting = (existingRows || []).filter(
      (row: any) => row.check_out >= today
    );

    const toDelete = futureExisting.filter(
      (row: any) => !freshHostawayIds.has(row.hostaway_reservation_id)
    );

    if (toDelete.length > 0) {
      console.log(`[Hostaway Sync] Removing ${toDelete.length} cancelled/declined reservations`);
      for (let i = 0; i < toDelete.length; i += BATCH) {
        const batch = toDelete.slice(i, i + BATCH);
        const ids = batch.map((r: any) => r.id);

        const { error: delError } = await supabase
          .from('reservations')
          .delete()
          .in('id', ids);

        if (delError) errors.push(`Delete batch error: ${delError.message}`);
        else removed += batch.length;

        if (i + BATCH < toDelete.length) {
          await new Promise((r) => setTimeout(r, 1200));
        }
      }
    }

    const result = {
      success: true,
      properties: listingsMap.size,
      properties_inserted: newListingRows.length,
      properties_updated: existingListingUpdates.length,
      reservations_fetched: reservations.length,
      reservations_inserted: inserted,
      reservations_updated: updated,
      reservations_removed: removed,
      errors: errors.length ? errors : undefined,
    };
    console.log('[Hostaway Sync] Complete:', JSON.stringify(result));
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[Hostaway Sync] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// GET for easy browser/testing access
export async function GET() {
  return POST();
}
