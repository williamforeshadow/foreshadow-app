import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { fetchListings, fetchReservations } from '@/lib/hostaway';

export async function POST() {
  try {
    const supabase = getSupabaseServer();

    // 1. Sync listings → properties
    const listingsMap = await fetchListings();

    const propertyRows = Array.from(listingsMap.entries()).map(([id, name]) => ({
      hostaway_listing_id: id,
      name,
      updated_at: new Date().toISOString(),
    }));

    await supabase
      .from('properties')
      .upsert(propertyRows, { onConflict: 'hostaway_listing_id' });

    // Build lookup: hostaway_listing_id → property uuid
    const { data: props } = await supabase
      .from('properties')
      .select('id, hostaway_listing_id');

    const propIdMap = new Map<number, string>();
    for (const p of props || []) propIdMap.set(p.hostaway_listing_id, p.id);

    // 2. Fetch current + future reservations from Hostaway
    const today = new Date().toISOString().split('T')[0];
    const reservations = await fetchReservations(today);

    // 3. Upsert in small batches (20 rows, 1.2s delay) to keep triggers happy
    const BATCH = 20;
    let synced = 0;
    const errors: string[] = [];

    // Collect all Hostaway reservation IDs we're syncing (for cleanup step)
    const syncedHostawayIds = new Set<number>();

    for (let i = 0; i < reservations.length; i += BATCH) {
      const rows = reservations.slice(i, i + BATCH).map((r: any) => {
        syncedHostawayIds.add(r.id);
        return {
          hostaway_reservation_id: r.id,
          property_id: propIdMap.get(r.listingMapId) || null,
          property_name:
            r.listingName ||
            listingsMap.get(r.listingMapId) ||
            `Listing ${r.listingMapId}`,
          guest_name:
            [r.guestFirstName, r.guestLastName].filter(Boolean).join(' ') ||
            'Unknown Guest',
          check_in: r.arrivalDate,
          check_out: r.departureDate,
          updated_at: new Date().toISOString(),
        };
      });

      const { error } = await supabase
        .from('reservations')
        .upsert(rows, {
          onConflict: 'hostaway_reservation_id',
          ignoreDuplicates: false,
        });

      if (error) errors.push(error.message);
      else synced += rows.length;

      if (i + BATCH < reservations.length) {
        await new Promise((r) => setTimeout(r, 1200));
      }
    }

    // 4. Remove cancelled/stale reservations
    //    Any Hostaway reservation in Supabase that is NOT in the fresh pull
    //    has been cancelled, declined, or is now in the past — delete it.
    let removed = 0;

    const { data: existingRows } = await supabase
      .from('reservations')
      .select('id, hostaway_reservation_id')
      .not('hostaway_reservation_id', 'is', null);

    if (existingRows) {
      const toDelete = existingRows.filter(
        (row: any) => !syncedHostawayIds.has(row.hostaway_reservation_id)
      );

      if (toDelete.length > 0) {
        // Delete in small batches to avoid trigger timeouts
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
    }

    return NextResponse.json({
      success: true,
      properties: propertyRows.length,
      reservations_fetched: reservations.length,
      reservations_synced: synced,
      reservations_removed: removed,
      errors: errors.length ? errors : undefined,
    });
  } catch (err: any) {
    console.error('Hostaway sync error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// GET for easy browser/testing access
export async function GET() {
  return POST();
}
