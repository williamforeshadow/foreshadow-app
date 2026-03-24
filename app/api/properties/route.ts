import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

// GET properties as { id, name } objects.
//
// The canonical property names come from the reservations table (property_name)
// which uses address-style names.  The properties table (synced from Hostaway
// listings) stores marketing titles that may differ.  To reliably resolve the
// UUID for each name the app uses, we pull the (property_name → property_id)
// mapping straight from reservations.
export async function GET() {
  try {
    const supabase = getSupabaseServer();

    // 1. Get all distinct (property_name, property_id) pairs from reservations.
    //    This is the source of truth for names displayed in the app.
    const { data: resPropRows, error: resError } = await supabase
      .from('reservations')
      .select('property_name, property_id');

    if (resError) {
      return NextResponse.json({ error: resError.message }, { status: 500 });
    }

    // De-duplicate: for each property_name keep the property_id (prefer non-null)
    const nameToId = new Map<string, string | null>();
    for (const r of resPropRows || []) {
      if (!r.property_name) continue;
      const existing = nameToId.get(r.property_name);
      if (!existing && r.property_id) {
        nameToId.set(r.property_name, r.property_id);
      } else if (!nameToId.has(r.property_name)) {
        nameToId.set(r.property_name, r.property_id);
      }
    }

    // 2. Also pull from get_property_turnovers for any property_names that
    //    might not appear in the reservations select above (edge case).
    const { data: turnovers } = await supabase.rpc('get_property_turnovers');
    for (const t of turnovers || []) {
      if (t.property_name && !nameToId.has(t.property_name)) {
        nameToId.set(t.property_name, null);
      }
    }

    // 3. Build sorted result
    const properties = Array.from(nameToId.entries())
      .map(([name, id]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ properties });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to fetch properties' },
      { status: 500 }
    );
  }
}
