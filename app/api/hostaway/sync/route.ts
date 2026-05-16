import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { fetchListings, fetchReservations } from '@/lib/hostaway';
import { runAutomationsForRowChange } from '@/src/server/automations/run';

// Columns selected back from the reservation insert, fed into the
// automations engine's row-change hook.
type InsertedReservation = {
  id: string;
  property_id: string;
  property_name: string;
  guest_name: string;
  check_in: string;
  check_out: string;
};

// Allow enough time for paginated Hostaway fetches + batched inserts
export const maxDuration = 120;

export async function POST() {
  try {
    console.log('[Hostaway Sync] Starting…');
    const supabase = getSupabaseServer();

    // 1. Sync listings → properties
    //
    // Explicit-import model: sync NEVER creates property rows. It only
    // refreshes `hostaway_name` on existing, already-linked rows so the
    // Hostaway snapshot stays current. User-customized `properties.name`
    // (the "property code") is never touched. Listings that aren't yet
    // bound to an app property are counted in `skippedUnlinked` and
    // otherwise ignored — users import them on demand via the UI.
    const listingsMap = await fetchListings();
    console.log(`[Hostaway Sync] Fetched ${listingsMap.size} listings`);

    const { data: existingPropsRaw } = await supabase
      .from('properties')
      .select('id, hostaway_listing_id, is_active');

    // hostaway_listing_id → property uuid, for ALL existing properties.
    const existingPropIdMap = new Map<number, string>();
    // Set of inactive property UUIDs. Inactive properties are treated as
    // "frozen": no Hostaway-name overwrites, no reservation inserts/updates,
    // no cancellation deletes — sync leaves them alone until reactivated.
    const inactivePropIds = new Set<string>();
    for (const p of existingPropsRaw || []) {
      if (p.hostaway_listing_id != null) {
        existingPropIdMap.set(p.hostaway_listing_id, p.id);
      }
      if (p.is_active === false) {
        inactivePropIds.add(p.id);
      }
    }

    const nowIso = new Date().toISOString();
    const existingListingUpdates: Array<{
      hostaway_listing_id: number;
      hostaway_name: string;
    }> = [];
    // Tracks listings that were seen from Hostaway but have no app row bound
    // to them yet. These are intentionally ignored — under the explicit-
    // import model, listings don't auto-materialize as properties. Users
    // import them via the "Add Property → From Hostaway" flow.
    let skippedUnlinked = 0;

    for (const [listingId, listingName] of listingsMap.entries()) {
      const existingUuid = existingPropIdMap.get(listingId);
      if (!existingUuid) {
        skippedUnlinked += 1;
        continue;
      }
      // Skip hostaway_name refresh for inactive properties.
      if (inactivePropIds.has(existingUuid)) continue;
      existingListingUpdates.push({
        hostaway_listing_id: listingId,
        hostaway_name: listingName,
      });
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

    // Build the hostaway_listing_id → property uuid lookup from current state.
    // (No newly-inserted rows to account for anymore.)
    const propIdMap = new Map<number, string>();
    for (const p of existingPropsRaw || []) {
      if (p.hostaway_listing_id != null) propIdMap.set(p.hostaway_listing_id, p.id);
    }

    // 2. Fetch current + future reservations from Hostaway
    const today = new Date().toISOString().split('T')[0];
    const reservations = await fetchReservations(today);
    console.log(`[Hostaway Sync] Fetched ${reservations.length} reservations from Hostaway`);

    // 3. Load existing Hostaway reservation IDs from Supabase so we know what's new
    //    (property_id included so we can gate inactive properties below)
    const { data: existingRows } = await supabase
      .from('reservations')
      .select('id, hostaway_reservation_id, check_in, check_out, guest_name, property_id')
      .not('hostaway_reservation_id', 'is', null);

    const existingMap = new Map<number, {
      id: string;
      check_in: string;
      check_out: string;
      guest_name: string;
      property_id: string | null;
    }>();
    for (const row of existingRows || []) {
      existingMap.set(row.hostaway_reservation_id, {
        id: row.id,
        check_in: row.check_in,
        check_out: row.check_out,
        guest_name: row.guest_name,
        property_id: row.property_id ?? null,
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

      // Resolve the canonical property_id this reservation maps to, so we can
      // gate inactive properties. Existing rows may already carry property_id
      // (from a prior sync); fall back to the current listingMapId → uuid.
      const resolvedPropertyId =
        existing?.property_id || propIdMap.get(r.listingMapId) || null;

      // Inactive properties are frozen: no inserts, no updates.
      if (resolvedPropertyId && inactivePropIds.has(resolvedPropertyId)) {
        continue;
      }

      if (!existing) {
        // Brand new reservation → INSERT (will trigger automations correctly)
        newRows.push({
          hostaway_reservation_id: r.id,
          property_id: resolvedPropertyId,
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

    // 4a. INSERT new reservations in batches (triggers fire = tasks created).
    //
    // We `.select()` after each insert so we get back the assigned UUIDs —
    // those flow into the Slack-automation runner below for `new_booking`
    // automations. Without `.select()` Supabase returns no rows on insert.
    const insertedReservations: InsertedReservation[] = [];
    for (let i = 0; i < newRows.length; i += BATCH) {
      const batch = newRows.slice(i, i + BATCH);
      const { data: returnedRows, error } = await supabase
        .from('reservations')
        .insert(batch)
        .select('id, property_id, property_name, guest_name, check_in, check_out');

      if (error) {
        errors.push(`Insert batch error: ${error.message}`);
      } else {
        inserted += batch.length;
        for (const r of (returnedRows ?? []) as InsertedReservation[]) {
          insertedReservations.push(r);
        }
      }

      if (i + BATCH < newRows.length) {
        await new Promise((r) => setTimeout(r, 1200));
      }
    }

    // Fire `created` row-change automations for each newly-inserted
    // reservation. Done off the response path via after() so a slow Slack
    // post can't extend the sync's wall time. Errors are logged but don't
    // bubble — automation failures shouldn't break the sync.
    if (insertedReservations.length > 0) {
      after(async () => {
        for (const reservation of insertedReservations) {
          try {
            await runAutomationsForRowChange(
              'reservation',
              'created',
              reservation as unknown as Record<string, unknown>,
            );
          } catch (err) {
            console.error('[Hostaway Sync] automation fire failed', {
              reservation_id: reservation.id,
              err,
            });
          }
        }
      });
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
      const uuid = propIdMap.get(listingId);
      if (uuid && inactivePropIds.has(uuid)) continue;
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

    const toDelete = futureExisting.filter((row: any) => {
      if (freshHostawayIds.has(row.hostaway_reservation_id)) return false;
      // Don't delete reservations belonging to inactive properties; sync is
      // frozen for those.
      if (row.property_id && inactivePropIds.has(row.property_id)) return false;
      return true;
    });

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
      // Always 0 under the explicit-import model; retained for client
      // compatibility (the list page's toast summary reads it).
      properties_inserted: 0,
      properties_updated: existingListingUpdates.length,
      properties_skipped_unlinked: skippedUnlinked,
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
