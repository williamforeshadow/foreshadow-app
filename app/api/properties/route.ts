import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

type PropertyRow = {
  id: string;
  name: string;
  hostaway_name: string | null;
  hostaway_listing_id: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

// GET /api/properties
//
// Returns properties from the `properties` table.
//
// Default behavior (active-only) is the safe path for picker dropdowns and
// anything that shouldn't offer deactivated rows. The Properties list page
// itself passes `?include_inactive=true` to see everything.
//
// Response shape (stable, additive):
//   {
//     properties: [
//       {
//         id: string (uuid),
//         name: string,                   // user-editable "property code"
//         hostaway_name: string | null,   // Hostaway's name snapshot (read-only)
//         hostaway_listing_id: number | null,
//         is_active: boolean,
//         created_at: string,
//         updated_at: string,
//       },
//       ...
//     ]
//   }
//
// Sorted alphabetically by `name`.
export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabaseServer();
    const includeInactive = req.nextUrl.searchParams.get('include_inactive') === 'true';
    // linked=true returns only Hostaway-linked rows (hostaway_listing_id IS NOT NULL).
    // Used by the "Link to Hostaway" picker so we can offer only rows that are
    // already syncing with Hostaway as merge candidates.
    const linkedOnly = req.nextUrl.searchParams.get('linked') === 'true';

    let query = supabase
      .from('properties')
      .select('id, name, hostaway_name, hostaway_listing_id, is_active, created_at, updated_at')
      .order('name', { ascending: true });

    if (!includeInactive) {
      query = query.eq('is_active', true);
    }
    if (linkedOnly) {
      query = query.not('hostaway_listing_id', 'is', null);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const properties = (data as PropertyRow[] | null || []).map((p) => ({
      id: p.id,
      name: p.name,
      hostaway_name: p.hostaway_name ?? null,
      hostaway_listing_id: p.hostaway_listing_id ?? null,
      is_active: p.is_active,
      created_at: p.created_at,
      updated_at: p.updated_at,
    }));

    return NextResponse.json({ properties });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to fetch properties' },
      { status: 500 }
    );
  }
}

// POST /api/properties
//
// Creates a property row. Two modes depending on the body:
//
//  A. Manual:   { name: string }
//     Creates an unlinked row with just `name`. is_active defaults to true,
//     no Hostaway linkage. Additional profile fields (address, bed/bath,
//     etc.) can be filled in via PATCH /api/properties/:id.
//
//  B. Import from Hostaway:  { hostaway_listing_id: number, name?: string }
//     Creates a Hostaway-linked row by pulling the listing's name from
//     Hostaway and stamping hostaway_listing_id + hostaway_name on the
//     new row. If `name` is provided, it's used as the user-editable
//     display name (otherwise we use the Hostaway name). is_active = true.
//
// Responses:
//   201 → { property: PropertyRow }
//   400 → invalid body
//   404 → (import mode) listing not found in Hostaway
//   409 → case-insensitive name collision, or listing already linked
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const rawHostawayId = body?.hostaway_listing_id;
    const hostawayListingId =
      typeof rawHostawayId === 'number' && Number.isFinite(rawHostawayId)
        ? Math.trunc(rawHostawayId)
        : null;
    const rawName = typeof body?.name === 'string' ? body.name.trim() : '';

    const supabase = getSupabaseServer();

    if (hostawayListingId != null) {
      // --- Import-from-Hostaway mode ---
      //
      // Double-check the listing isn't already bound to an app row, then
      // pull its name from Hostaway so we have something to store as
      // hostaway_name. We import the listings map lazily here to avoid
      // paying for a live Hostaway fetch on the manual path.
      const { data: existing, error: existingErr } = await supabase
        .from('properties')
        .select('id, name')
        .eq('hostaway_listing_id', hostawayListingId)
        .maybeSingle();
      if (existingErr) {
        return NextResponse.json({ error: existingErr.message }, { status: 500 });
      }
      if (existing) {
        return NextResponse.json(
          {
            error: `Hostaway listing ${hostawayListingId} is already linked to "${existing.name}"`,
          },
          { status: 409 }
        );
      }

      const { fetchListings } = await import('@/lib/hostaway');
      const listingsMap = await fetchListings();
      const hostawayName = listingsMap.get(hostawayListingId);
      if (!hostawayName) {
        return NextResponse.json(
          { error: `Hostaway listing ${hostawayListingId} not found` },
          { status: 404 }
        );
      }

      const displayName = rawName || hostawayName;

      const { data, error } = await supabase
        .from('properties')
        .insert({
          name: displayName,
          hostaway_listing_id: hostawayListingId,
          hostaway_name: hostawayName,
        })
        .select(
          'id, name, hostaway_name, hostaway_listing_id, is_active, created_at, updated_at'
        )
        .maybeSingle();

      if (error) {
        if (error.code === '23505') {
          return NextResponse.json(
            {
              error: `A property named "${displayName}" already exists — rename it or import with a different name`,
            },
            { status: 409 }
          );
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      if (!data) {
        return NextResponse.json({ error: 'Failed to create property' }, { status: 500 });
      }
      return NextResponse.json({ property: data }, { status: 201 });
    }

    // --- Manual mode ---
    if (!rawName) {
      return NextResponse.json(
        { error: 'Property name is required' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('properties')
      .insert({ name: rawName })
      .select('id, name, hostaway_name, hostaway_listing_id, is_active, created_at, updated_at')
      .maybeSingle();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: `A property named "${rawName}" already exists` },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: 'Failed to create property' }, { status: 500 });
    }

    return NextResponse.json({ property: data }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to create property' },
      { status: 500 }
    );
  }
}
