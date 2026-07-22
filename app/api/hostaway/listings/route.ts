import { NextRequest, NextResponse } from 'next/server';
import { fetchListings } from '@/lib/hostaway';
import { requireAuthContext } from '@/lib/requireAuthContext';
import { getHostawayCredsForOrg } from '@/lib/pmsIntegrations';

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
    const ctx = await requireAuthContext();
    if (ctx instanceof NextResponse) return ctx;
    const { supabase, orgId } = ctx;

    const onlyAvailable = req.nextUrl.searchParams.get('available') === 'true';

    // These two failures mean opposite things and must not share a handler.
    // Collapsing them (one try/catch returning an empty list) made a broken
    // integration or an unreachable Hostaway indistinguishable from "you've
    // already imported everything" — the picker just showed nothing, with no
    // way to tell that a fetch had failed at all.
    let creds;
    try {
      creds = await getHostawayCredsForOrg(orgId);
    } catch {
      // Genuinely empty: this org has no Hostaway integration, so there is
      // nothing to import and that isn't an error worth surfacing.
      return NextResponse.json({ listings: [], hostaway_connected: false });
    }

    let listingsMap: Map<number, string>;
    try {
      listingsMap = await fetchListings(creds);
    } catch (err) {
      // Credentials exist but Hostaway didn't answer — a real failure.
      console.error('[Hostaway Listings] fetch failed:', err);
      return NextResponse.json(
        { error: "Couldn't reach Hostaway. Check the integration credentials and try again." },
        { status: 502 },
      );
    }

    const propsRes = await supabase
      .from('properties')
      .select('id, name, hostaway_listing_id');
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
