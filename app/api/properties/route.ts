import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

// GET properties as { id, name } objects from the properties table,
// merged with any extra names from get_property_turnovers that haven't
// been added to the properties table yet.
export async function GET() {
  try {
    const supabase = getSupabaseServer();

    // 1. Fetch from the properties table (Hostaway-synced, has real IDs)
    const { data: propsTable, error: propsError } = await supabase
      .from('properties')
      .select('id, name')
      .order('name', { ascending: true });

    if (propsError) {
      return NextResponse.json(
        { error: propsError.message },
        { status: 500 }
      );
    }

    // Build a set of names we already have from the properties table
    const knownNames = new Set(
      (propsTable || []).map((p: any) => p.name)
    );

    // 2. Also fetch from get_property_turnovers for any stragglers
    //    (properties that exist in reservations but not yet in properties table)
    const { data: turnovers } = await supabase.rpc('get_property_turnovers');

    const extraNames = Array.from(
      new Set(
        (turnovers || [])
          .map((t: any) => t.property_name)
          .filter((n: string) => n && !knownNames.has(n))
      )
    ).sort() as string[];

    // 3. Merge: properties table entries first, then extras (with null id)
    const properties = [
      ...(propsTable || []).map((p: any) => ({ id: p.id, name: p.name })),
      ...extraNames.map((name) => ({ id: null, name })),
    ].sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ properties });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to fetch properties' },
      { status: 500 }
    );
  }
}
