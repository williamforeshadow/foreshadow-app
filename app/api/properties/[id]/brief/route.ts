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
//    notes: Array<{ scope, title, body, ... }>,
//    contacts: Array<{ category, name, phone, ... }>,
//    rooms: Array<{
//      id, scope, type, title,
//      photos: [...],
//      cards: Array<{ tag, title, body, tag_data, photos: [...] }>,
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
    notesRes,
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
      .from('property_notes')
      .select('id, scope, title, body, sort_order, updated_at')
      .eq('property_id', id)
      .order('scope', { ascending: true })
      .order('sort_order', { ascending: true }),
    supabase
      .from('property_contacts')
      .select('id, category, name, role, phone, email, notes, sort_order')
      .eq('property_id', id)
      .order('category', { ascending: true })
      .order('sort_order', { ascending: true }),
    supabase
      .from('property_rooms')
      .select(
        `
        id, scope, type, title, sort_order,
        property_room_photos (id, storage_path, caption, sort_order),
        property_cards (
          id, tag, title, body, tag_data, sort_order,
          property_card_photos (id, storage_path, caption, sort_order)
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
    ['notes', notesRes],
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
    notes: notesRes.error ? [] : notesRes.data ?? [],
    contacts: contactsRes.error ? [] : contactsRes.data ?? [],
    rooms: roomsRes.error ? [] : roomsRes.data ?? [],
    documents: docsRes.error ? [] : docsRes.data ?? [],
    ...(warnings.length > 0 ? { warnings } : {}),
  });
}
