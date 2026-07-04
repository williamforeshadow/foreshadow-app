import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { getPrimaryHospitableIntegration, hospitableCredsFor } from '@/lib/pmsIntegrations';
import { fetchHospitableProperties, fetchHospitableReservations } from '@/lib/hospitable';
import { getMapper } from '@/src/server/messages/pms';
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
    const mapper = getMapper('hospitable');
    const now = new Date().toISOString();

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
    let reservationsUpserted = 0;
    let messagesIngested = 0;
    for (const [hospId, prop] of propByHospId) {
      let reservations: any[];
      try {
        reservations = await fetchHospitableReservations(creds, [hospId]);
      } catch (err) {
        errors.push(`reservations (${hospId}): ${err instanceof Error ? err.message : 'failed'}`);
        continue;
      }
      if (reservations.length === 0) continue;

      const resRows = reservations.map((r: any) => {
        const guest = r.guest ?? {};
        const guestName =
          [guest.first_name, guest.last_name].filter(Boolean).join(' ') || null;
        const statusCategory = r.reservation_status?.current?.category ?? r.status ?? null;
        const isOwner = r.stay_type === 'owner_stay' || r.owner_stay != null;
        return {
          org_id: orgId,
          hospitable_reservation_id: String(r.id),
          property_id: prop.id,
          property_name: prop.name,
          guest_name: guestName ?? (isOwner ? 'Owner Stay' : 'Guest'),
          check_in: r.check_in ?? r.arrival_date ?? null,
          check_out: r.check_out ?? r.departure_date ?? null,
          channel: mapper.mapChannel(r.platform),
          kind: isOwner ? 'owner_stay' : 'guest_booking',
          updated_at: now,
        };
      });

      const { error } = await supabase
        .from('reservations')
        .upsert(resRows, { onConflict: 'org_id,hospitable_reservation_id' });
      if (error) errors.push(`reservations upsert (${hospId}): ${error.message}`);
      else reservationsUpserted += resRows.length;

      // Pull each reservation's message thread into conversations/guest_messages.
      for (const r of reservations) {
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

    const result = {
      success: true,
      properties_upserted: propertiesUpserted,
      reservations_upserted: reservationsUpserted,
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
