import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { fetchListings } from '@/lib/hostaway';

// POST /api/properties/:id/link
//
// Binds an existing (typically manually-created) app property to a Hostaway
// listing. This is a non-destructive operation: it simply stamps
// hostaway_listing_id + hostaway_name on the row. Existing reservations,
// tasks, and bins stay untouched.
//
// Body: { hostaway_listing_id: number }
//
// Guards:
//   - This property must not already be linked (unlink first).
//   - The requested listing must exist in Hostaway.
//   - The listing must not already be bound to a different app property.
//
// Responses:
//   200 → { property: PropertyRow }
//   400 → invalid body
//   404 → listing not found in Hostaway
//   409 → this property is already linked, OR the listing is already bound
//         to another property
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const rawHostawayId = body?.hostaway_listing_id;
    const hostawayListingId =
      typeof rawHostawayId === 'number' && Number.isFinite(rawHostawayId)
        ? Math.trunc(rawHostawayId)
        : null;

    if (hostawayListingId == null) {
      return NextResponse.json(
        { error: 'hostaway_listing_id (number) is required' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseServer();

    const { data: survivor, error: survivorErr } = await supabase
      .from('properties')
      .select('id, hostaway_listing_id')
      .eq('id', id)
      .maybeSingle();
    if (survivorErr) {
      return NextResponse.json({ error: survivorErr.message }, { status: 500 });
    }
    if (!survivor) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    }
    if (survivor.hostaway_listing_id != null) {
      return NextResponse.json(
        { error: 'Property is already linked to Hostaway (unlink first)' },
        { status: 409 }
      );
    }

    const { data: dup, error: dupErr } = await supabase
      .from('properties')
      .select('id, name')
      .eq('hostaway_listing_id', hostawayListingId)
      .maybeSingle();
    if (dupErr) {
      return NextResponse.json({ error: dupErr.message }, { status: 500 });
    }
    if (dup) {
      return NextResponse.json(
        {
          error: `Hostaway listing ${hostawayListingId} is already linked to "${dup.name}"`,
        },
        { status: 409 }
      );
    }

    const listingsMap = await fetchListings();
    const hostawayName = listingsMap.get(hostawayListingId);
    if (!hostawayName) {
      return NextResponse.json(
        { error: `Hostaway listing ${hostawayListingId} not found` },
        { status: 404 }
      );
    }

    // Linking is an explicit "this is now a real, operational property"
    // action, so we also flip is_active → true if it was off. Matches the
    // behavior we established for the old merge flow.
    const { data, error: updateErr } = await supabase
      .from('properties')
      .update({
        hostaway_listing_id: hostawayListingId,
        hostaway_name: hostawayName,
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select(
        'id, name, hostaway_name, hostaway_listing_id, is_active, address_street, address_city, address_state, address_zip, address_country, latitude, longitude, bedrooms, bathrooms, created_at, updated_at'
      )
      .maybeSingle();

    if (updateErr) {
      // Race: another request grabbed this listing between our check and
      // our UPDATE. Surface as a clean 409 instead of a generic 500.
      if ((updateErr as any).code === '23505') {
        return NextResponse.json(
          { error: `Hostaway listing ${hostawayListingId} was linked elsewhere — refresh and try again` },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Link failed' }, { status: 500 });
    }

    return NextResponse.json({ property: data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to link property' },
      { status: 500 }
    );
  }
}
