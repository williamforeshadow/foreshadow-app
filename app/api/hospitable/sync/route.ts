import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { getPrimaryHospitableIntegration, hospitableCredsFor } from '@/lib/pmsIntegrations';
import { fetchHospitableProperties, fetchHospitableReservations } from '@/lib/hospitable';
import { ingestHospitableThread } from '@/src/server/messages/ingestHospitable';

// Hospitable reservation + property sync (P4).
//
// Unlike the Hostaway sync's explicit-import model, this AUTO-imports: a fresh
// org's properties come straight from its PMS. Records are keyed by
// (org_id, hospitable_property_id) / (org_id, hospitable_reservation_id) and
// every write carries org_id, so the data lands isolated under the integration's
// org. Reservations are fetched per-property so each maps unambiguously.

export const maxDuration = 120;

function toNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function POST() {
  try {
    const supabase = getSupabaseServer();

    const integration = await getPrimaryHospitableIntegration();
    if (!integration) {
      return NextResponse.json({ success: true, skipped: 'no_integration' });
    }
    const creds = hospitableCredsFor(integration);
    const orgId = integration.org_id;
    const now = new Date().toISOString();

    // Hospitable's /reservations endpoint defaults to a narrow ~2-week window;
    // without an explicit start_date/end_date it silently omits everything
    // further out. Request the full operational range so org-2 mirrors the PMS.
    const nowMs = Date.now();
    const DAY = 86_400_000;
    const startDate = new Date(nowMs - 90 * DAY).toISOString().slice(0, 10);
    const endDate = new Date(nowMs + 730 * DAY).toISOString().slice(0, 10);
    // Backfill message threads only for active/near-term stays — future bookings
    // rarely have threads yet, and fetching one per reservation across the full
    // window would blow the function's time budget. Real-time arrives by webhook.
    const msgWindowEnd = nowMs + 30 * DAY;

    // 1. Properties → upsert.
    const properties = await fetchHospitableProperties(creds);
    const propRows = properties.map((p: any) => ({
      org_id: orgId,
      hospitable_property_id: String(p.id),
      name: p.name || p.public_name || `Property ${String(p.id).slice(0, 8)}`,
      address_street: p.address?.street ?? null,
      address_city: p.address?.city ?? null,
      address_state: p.address?.state ?? null,
      address_zip: p.address?.postcode ?? null,
      address_country: p.address?.country ?? null,
      latitude: toNum(p.address?.coordinates?.latitude),
      longitude: toNum(p.address?.coordinates?.longitude),
      bedrooms: toNum(p.capacity?.bedrooms),
      bathrooms: toNum(p.capacity?.bathrooms),
      is_active: p.listed !== false,
      updated_at: now,
    }));

    let propertiesUpserted = 0;
    const errors: string[] = [];
    if (propRows.length > 0) {
      const { error } = await supabase
        .from('properties')
        .upsert(propRows, { onConflict: 'org_id,hospitable_property_id' });
      if (error) errors.push(`properties upsert: ${error.message}`);
      else propertiesUpserted = propRows.length;
    }

    // Map hospitable_property_id -> { id, name } for reservation linking.
    const { data: propLookup } = await supabase
      .from('properties')
      .select('id, name, hospitable_property_id')
      .eq('org_id', orgId)
      .not('hospitable_property_id', 'is', null);
    const propByHospId = new Map<string, { id: string; name: string }>();
    for (const p of (propLookup ?? []) as Array<{ id: string; name: string; hospitable_property_id: string }>) {
      propByHospId.set(p.hospitable_property_id, { id: p.id, name: p.name });
    }

    // 2. Reservations, per property (so each maps to its property unambiguously).
    //    Import ACCEPTED/confirmed only — Hospitable also returns inquiries,
    //    expired requests, and cancellations, which must never show as bookings.
    const isAccepted = (r: any) =>
      (r.reservation_status?.current?.category ?? r.status) === 'accepted';

    let reservationsUpserted = 0;
    let messagesIngested = 0;
    const nonAcceptedIds: string[] = [];
    for (const [hospId, prop] of propByHospId) {
      let reservations: any[];
      try {
        reservations = await fetchHospitableReservations(creds, [hospId], {
          start_date: startDate,
          end_date: endDate,
        });
      } catch (err) {
        errors.push(`reservations (${hospId}): ${err instanceof Error ? err.message : 'failed'}`);
        continue;
      }
      const accepted = reservations.filter(isAccepted);
      // Track the ones Hospitable EXPLICITLY returned as non-accepted so we can
      // remove any we previously imported (see cleanup below).
      for (const r of reservations) if (!isAccepted(r)) nonAcceptedIds.push(String(r.id));
      if (accepted.length === 0) continue;

      const resRows = accepted.map((r: any) => {
        const guest = r.guest ?? {};
        const guestName =
          [guest.first_name, guest.last_name].filter(Boolean).join(' ') || null;
        const isOwner = r.stay_type === 'owner_stay' || r.owner_stay != null;
        // Guest contact + party size. Hospitable nests contact under `guest`
        // (email/phone require the connected token's PII scope, else they arrive
        // null) and exposes party size either as a `guests` object or a flat
        // count — map defensively across those shapes.
        const guestEmail: string | null = guest.email ?? null;
        const guestPhone: string | null =
          guest.phone ??
          guest.phone_number ??
          (Array.isArray(guest.phone_numbers) ? guest.phone_numbers[0] ?? null : null);
        const guestCountRaw = Number(r.guests?.total ?? r.number_of_guests ?? r.guests);
        const guestCount: number | null =
          Number.isFinite(guestCountRaw) && guestCountRaw > 0 ? guestCountRaw : null;
        return {
          org_id: orgId,
          hospitable_reservation_id: String(r.id),
          property_id: prop.id,
          property_name: prop.name,
          guest_name: guestName ?? (isOwner ? 'Owner Stay' : 'Guest'),
          guest_email: guestEmail,
          guest_phone: guestPhone,
          guest_count: guestCount,
          check_in: r.check_in ?? r.arrival_date ?? null,
          check_out: r.check_out ?? r.departure_date ?? null,
          // Store the raw PMS channel (matching the Hostaway sync's raw
          // channelName); normalize at read time via canonicalChannelKey /
          // channelLabel so both orgs share one vocabulary.
          channel: r.platform ?? null,
          channel_source: r.source ?? null,
          kind: isOwner ? 'owner_stay' : 'guest_booking',
          updated_at: now,
        };
      });

      const { error } = await supabase
        .from('reservations')
        .upsert(resRows, { onConflict: 'org_id,hospitable_reservation_id' });
      if (error) errors.push(`reservations upsert (${hospId}): ${error.message}`);
      else reservationsUpserted += resRows.length;

      // Pull message threads only for active/near-term stays (see msgWindowEnd).
      const nearTerm = accepted.filter((r: any) => {
        const co = Date.parse(r.check_out ?? r.departure_date ?? '');
        const ci = Date.parse(r.check_in ?? r.arrival_date ?? '');
        return Number.isFinite(co) && Number.isFinite(ci)
          ? co >= nowMs && ci <= msgWindowEnd
          : true; // undated → don't silently skip
      });
      for (const r of nearTerm) {
        try {
          messagesIngested += await ingestHospitableThread(
            { creds, orgId },
            String(r.id),
            { realtime: false },
          );
        } catch (err) {
          errors.push(`messages (${r.id}): ${err instanceof Error ? err.message : 'failed'}`);
        }
        await new Promise((res) => setTimeout(res, 200));
      }

      await new Promise((r) => setTimeout(r, 200)); // rate-limit friendly
    }

    // Remove previously-imported reservations that Hospitable now reports as
    // non-accepted (expired inquiries, cancellations) + their conversation/
    // messages, so they stop showing as phantom bookings. Keyed ONLY on ids the
    // fetch explicitly returned as non-accepted — never on "absent from fetch",
    // so a transient per-property fetch failure can't wipe real reservations.
    let reservationsRemoved = 0;
    if (nonAcceptedIds.length > 0) {
      const { data: stale } = await supabase
        .from('reservations')
        .select('id')
        .eq('org_id', orgId)
        .in('hospitable_reservation_id', nonAcceptedIds);
      const staleIds = (stale ?? []).map((r: any) => r.id as string);
      if (staleIds.length > 0) {
        const { data: staleConvs } = await supabase
          .from('conversations')
          .select('id')
          .eq('org_id', orgId)
          .in('reservation_id', staleIds);
        const convIds = (staleConvs ?? []).map((c: any) => c.id as string);
        if (convIds.length > 0) {
          await supabase.from('guest_messages').delete().eq('org_id', orgId).in('conversation_id', convIds);
          await supabase.from('conversations').delete().eq('org_id', orgId).in('id', convIds);
        }
        const { data: removed } = await supabase
          .from('reservations')
          .delete()
          .eq('org_id', orgId)
          .in('id', staleIds)
          .select('id');
        reservationsRemoved = removed?.length ?? 0;
      }
    }

    const result = {
      success: true,
      properties_upserted: propertiesUpserted,
      reservations_upserted: reservationsUpserted,
      reservations_removed: reservationsRemoved,
      messages_ingested: messagesIngested,
      errors: errors.length ? errors : undefined,
    };
    console.log('[Hospitable Sync] Complete:', JSON.stringify(result));
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[Hospitable Sync] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// GET for easy manual/browser trigger, mirroring /api/hostaway/sync.
export async function GET() {
  return POST();
}
