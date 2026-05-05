import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

// GET /api/properties/:id — fetch a single property's full profile.
//
// Response:
//   {
//     property: {
//       id, name, hostaway_name, hostaway_listing_id,
//       address_street, address_city, address_state, address_zip, address_country,
//       latitude, longitude,
//       bedrooms, bathrooms,
//       created_at, updated_at,
//     }
//   }
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = getSupabaseServer();

    const { data, error } = await supabase
      .from('properties')
      .select(
        'id, name, hostaway_name, hostaway_listing_id, is_active, address_street, address_city, address_state, address_zip, address_country, latitude, longitude, bedrooms, bathrooms, timezone, created_at, updated_at'
      )
      .eq('id', id)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    }

    return NextResponse.json({ property: data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to fetch property' },
      { status: 500 }
    );
  }
}

// Editable fields accepted by PATCH. `name` is special: it triggers a
// cascading rename via the rename_property() RPC so denormalized
// property_name copies in reservations / property_templates / turnover_tasks
// stay in sync.
const EDITABLE_FIELDS = new Set([
  'name',
  'is_active',
  'address_street',
  'address_city',
  'address_state',
  'address_zip',
  'address_country',
  'latitude',
  'longitude',
  'bedrooms',
  'bathrooms',
  'timezone',
]);

// PATCH /api/properties/:id — update any subset of the editable fields.
// Readonly fields (hostaway_listing_id, hostaway_name, timestamps, id) are ignored.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const supabase = getSupabaseServer();

    // Partition incoming body into name (special) vs direct column updates.
    const directUpdates: Record<string, unknown> = {};
    let newName: string | null = null;

    for (const [key, value] of Object.entries(body || {})) {
      if (!EDITABLE_FIELDS.has(key)) continue;
      if (key === 'name') {
        if (typeof value !== 'string' || value.trim().length === 0) {
          return NextResponse.json(
            { error: 'name must be a non-empty string' },
            { status: 400 }
          );
        }
        newName = value.trim();
      } else if (key === 'is_active') {
        if (typeof value !== 'boolean') {
          return NextResponse.json(
            { error: 'is_active must be a boolean' },
            { status: 400 }
          );
        }
        directUpdates[key] = value;
      } else if (key === 'timezone') {
        if (value === null || value === '') {
          directUpdates[key] = null;
        } else if (typeof value === 'string') {
          try {
            const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: value.trim() });
            directUpdates[key] = fmt.resolvedOptions().timeZone;
          } catch {
            return NextResponse.json(
              { error: 'timezone must be a valid IANA timezone string (e.g. "America/Los_Angeles") or null' },
              { status: 400 },
            );
          }
        } else {
          return NextResponse.json(
            { error: 'timezone must be a string or null' },
            { status: 400 },
          );
        }
      } else {
        directUpdates[key] = value;
      }
    }

    if (newName === null && Object.keys(directUpdates).length === 0) {
      return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 });
    }

    // 1. Cascade rename via RPC (atomic across 4 tables).
    if (newName !== null) {
      const { error: renameErr } = await supabase.rpc('rename_property', {
        p_id: id,
        p_new_name: newName,
      });
      if (renameErr) {
        // Surface the case-insensitive uniqueness collision with a friendlier
        // message. rename_property wraps UPDATE, so the unique index still
        // fires and bubbles up as 23505.
        if ((renameErr as any).code === '23505') {
          return NextResponse.json(
            { error: `A property named "${newName}" already exists` },
            { status: 409 }
          );
        }
        return NextResponse.json(
          { error: `Rename failed: ${renameErr.message}` },
          { status: 500 }
        );
      }
    }

    // 2. Apply non-name column updates.
    if (Object.keys(directUpdates).length > 0) {
      directUpdates.updated_at = new Date().toISOString();
      const { error: updateErr } = await supabase
        .from('properties')
        .update(directUpdates)
        .eq('id', id);

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }
    }

    // 3. Return the fresh record.
    const { data, error: fetchErr } = await supabase
      .from('properties')
      .select(
        'id, name, hostaway_name, hostaway_listing_id, is_active, address_street, address_city, address_state, address_zip, address_country, latitude, longitude, bedrooms, bathrooms, timezone, created_at, updated_at'
      )
      .eq('id', id)
      .maybeSingle();

    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Property not found after update' }, { status: 404 });
    }

    return NextResponse.json({ property: data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to update property' },
      { status: 500 }
    );
  }
}
