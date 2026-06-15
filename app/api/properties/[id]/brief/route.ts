import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

// GET /api/properties/[id]/brief
//
// Returns everything an AI agent might need to reason about a property
// in a single call. Runs server-side through the service role so secrets
// (access codes, wifi password) are included — agents are trusted.
//
// Shape:
//  {
//    property: { ... summary fields },
//    access: { ... property_access row ... } | null,
//    connectivity: { wifi_ssid, wifi_password, wifi_router_location } | null,
//    tech_accounts: Array<{ kind, service_name, username, password, notes, photos: [...] }>,
//    contacts: Array<{ tags, name, phone, schedule, preferences, ... }>,
//    rooms: Array<{
//      id, scope, title, notes,
//      photos: [...],
//      property_attributes: Array<{ tags, title, body, photos: [...] }>,
//    }>,
//    documents: Array<{ tag, title, notes, storage_path, ... }>,
//  }

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = getSupabaseServer();

  const [
    propertyRes,
    accessRes,
    connectivityRes,
    techAccountsRes,
    contactsRes,
    roomsRes,
    docsRes,
  ] = await Promise.all([
    supabase
      .from('properties')
      .select(
        'id, name, hostaway_name, hostaway_listing_id, is_active, address_street, address_city, address_state, address_zip, address_country, latitude, longitude, bedrooms, bathrooms, created_at, updated_at'
      )
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('property_access')
      .select('*')
      .eq('property_id', id)
      .maybeSingle(),
    supabase
      .from('property_connectivity')
      .select('*')
      .eq('property_id', id)
      .maybeSingle(),
    supabase
      .from('property_tech_accounts')
      .select(
        `
        id, kind, service_name, username, password, notes, sort_order,
        property_tech_account_photos (id, storage_path, sort_order)
        `
      )
      .eq('property_id', id)
      .order('sort_order', { ascending: true }),
    supabase
      .from('property_contacts')
      .select('id, tags, name, role, phone, email, schedule, preferences, notes, sort_order')
      .eq('property_id', id)
      .order('sort_order', { ascending: true }),
    supabase
      .from('property_rooms')
      .select(
        `
        id, scope, title, notes, sort_order,
        property_room_photos (id, storage_path, caption, sort_order),
        property_attributes (
          id, tags, title, body, sort_order,
          property_attribute_photos (id, storage_path, caption, sort_order)
        )
        `
      )
      .eq('property_id', id)
      .order('scope', { ascending: true })
      .order('sort_order', { ascending: true }),
    supabase
      .from('property_documents')
      .select('id, tag, title, notes, storage_path, mime_type, size_bytes, original_filename, created_at')
      .eq('property_id', id)
      .order('tag', { ascending: true })
      .order('created_at', { ascending: false }),
  ]);

  if (propertyRes.error) {
    return NextResponse.json(
      { error: propertyRes.error.message },
      { status: 500 }
    );
  }
  if (!propertyRes.data) {
    return NextResponse.json({ error: 'Property not found' }, { status: 404 });
  }

  // Surface individual sub-query errors if they happen but still return
  // the fields we do have — an agent can often use a partial brief.
  const warnings: string[] = [];
  for (const [key, res] of [
    ['access', accessRes],
    ['connectivity', connectivityRes],
    ['tech_accounts', techAccountsRes],
    ['contacts', contactsRes],
    ['rooms', roomsRes],
    ['documents', docsRes],
  ] as const) {
    if (res.error) {
      warnings.push(`${key}: ${res.error.message}`);
    }
  }

  return NextResponse.json({
    property: propertyRes.data,
    access: accessRes.error ? null : accessRes.data ?? null,
    connectivity: connectivityRes.error ? null : connectivityRes.data ?? null,
    tech_accounts: techAccountsRes.error ? [] : techAccountsRes.data ?? [],
    contacts: contactsRes.error ? [] : contactsRes.data ?? [],
    rooms: roomsRes.error ? [] : roomsRes.data ?? [],
    documents: docsRes.error ? [] : docsRes.data ?? [],
    ...(warnings.length > 0 ? { warnings } : {}),
  });
}
