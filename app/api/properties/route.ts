import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

// GET /api/properties
//
// Returns every property row from the `properties` table — including:
//   - Hostaway-synced properties (`hostaway_listing_id` populated)
//   - Manually-created app-only properties (`hostaway_listing_id` null)
//   - Hostaway listings that have no reservations yet
//
// Response shape (stable, additive):
//   {
//     properties: [
//       {
//         id: string (uuid),
//         name: string,                   // user-editable "property code"
//         hostaway_name: string | null,   // Hostaway's name snapshot (read-only)
//         hostaway_listing_id: number | null,
//         created_at: string,
//         updated_at: string,
//       },
//       ...
//     ]
//   }
//
// Sorted alphabetically by `name`. Existing callers that only read `{ id, name }`
// continue to work; the extra fields are ignored.
export async function GET() {
  try {
    const supabase = getSupabaseServer();

    const { data, error } = await supabase
      .from('properties')
      .select('id, name, hostaway_name, hostaway_listing_id, created_at, updated_at')
      .order('name', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const properties = (data || []).map((p: {
      id: string;
      name: string;
      hostaway_name: string | null;
      hostaway_listing_id: number | null;
      created_at: string;
      updated_at: string;
    }) => ({
      id: p.id,
      name: p.name,
      hostaway_name: p.hostaway_name ?? null,
      hostaway_listing_id: p.hostaway_listing_id ?? null,
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
