import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

// POST /api/properties/:id/unlink
//
// Clears the property's Hostaway linkage (hostaway_listing_id +
// hostaway_name). The row itself — including address, bed/bath, and any
// reservations/tasks generated while it was linked — is preserved; only the
// Hostaway linkage is removed, so future Hostaway syncs will no longer
// update this row's hostaway_name or import reservations against it.
//
// Note: the next Hostaway sync will see that listing as "unknown" and
// re-insert it as a new Hostaway-synced property row. Users who want to
// permanently detach without re-import on next sync should deactivate
// (is_active = false) instead — or remove the listing in Hostaway itself.
//
// 200 → { property: PropertyRow }
// 404 → property not found
// 409 → property is not currently linked
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = getSupabaseServer();

    const { data: existing, error: fetchErr } = await supabase
      .from('properties')
      .select('id, hostaway_listing_id')
      .eq('id', id)
      .maybeSingle();
    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    }
    if (existing.hostaway_listing_id == null) {
      return NextResponse.json(
        { error: 'Property is not linked to Hostaway' },
        { status: 409 }
      );
    }

    const { data, error: updateErr } = await supabase
      .from('properties')
      .update({
        hostaway_listing_id: null,
        hostaway_name: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select(
        'id, name, hostaway_name, hostaway_listing_id, is_active, address_street, address_city, address_state, address_zip, address_country, latitude, longitude, bedrooms, bathrooms, created_at, updated_at'
      )
      .maybeSingle();

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Unlink failed' }, { status: 500 });
    }

    return NextResponse.json({ property: data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to unlink property' },
      { status: 500 }
    );
  }
}
