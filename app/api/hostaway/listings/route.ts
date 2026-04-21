import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { fetchListings } from '@/lib/hostaway';

// GET /api/hostaway/listings
//
// Live-fetches all listings from Hostaway and cross-references them against
// the `properties` table so the UI can see which listings are already
// bound to an app property and which are available for import/linking.
//
// Query params:
//   ?available=true   — return only listings that are NOT already bound to
//                       an app property (i.e. hostaway_listing_id is not
//                       in use on any properties row). Used by the "Add
//                       Property → From Hostaway" and "Link to listing"
//                       pickers so users can't accidentally double-bind.
//
// Response:
//   {
//     listings: Array<{
//       hostaway_listing_id: number,
//       name: string,                         // Hostaway-provided name
//       already_linked: boolean,              // true if an app row already
//                                             //   owns this listing
//       linked_property_id: string | null,    // uuid of that app row
//       linked_property_name: string | null,  // user-edited display name
//     }>
//   }
export async function GET(req: NextRequest) {
  try {
    const onlyAvailable = req.nextUrl.searchParams.get('available') === 'true';

    const supabase = getSupabaseServer();
    const [listingsMap, propsRes] = await Promise.all([
      fetchListings(),
      supabase.from('properties').select('id, name, hostaway_listing_id'),
    ]);

    if (propsRes.error) {
      return NextResponse.json(
        { error: propsRes.error.message },
        { status: 500 }
      );
    }

    // hostaway_listing_id → { property uuid, property name }
    const linkIndex = new Map<number, { id: string; name: string }>();
    for (const p of propsRes.data || []) {
      if (p.hostaway_listing_id != null) {
        linkIndex.set(p.hostaway_listing_id, { id: p.id, name: p.name });
      }
    }

    const listings: Array<{
      hostaway_listing_id: number;
      name: string;
      already_linked: boolean;
      linked_property_id: string | null;
      linked_property_name: string | null;
    }> = [];

    for (const [listingId, listingName] of listingsMap.entries()) {
      const link = linkIndex.get(listingId);
      if (onlyAvailable && link) continue;
      listings.push({
        hostaway_listing_id: listingId,
        name: listingName,
        already_linked: !!link,
        linked_property_id: link?.id ?? null,
        linked_property_name: link?.name ?? null,
      });
    }

    listings.sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ listings });
  } catch (err: any) {
    console.error('[Hostaway Listings] Error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to fetch Hostaway listings' },
      { status: 500 }
    );
  }
}
