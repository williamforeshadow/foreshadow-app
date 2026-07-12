import { getSupabaseServer } from '@/lib/supabaseServer';

// Shared property-knowledge loader — the single 8-read dossier query used by the
// get_property_knowledge agent tool (full, ops-facing) and the
// get_property_knowledge_for_guest tool (filtered to the unlocked allowlist).
// Pulls every "Knowledge" section the UI exposes. Photos are metadata only
// (storage_path); no signed URLs or binary content.

export interface PropertyRow {
  id: string;
  name: string;
  hostaway_name: string | null;
  hostaway_listing_id: number | null;
  is_active: boolean;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  address_country: string | null;
  latitude: number | null;
  longitude: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  timezone: string | null;
  created_at: string;
  updated_at: string;
}

// Sub-section payloads are wide and column-stable but evolve faster than callers
// should care about, so they flow through as opaque JSON-shaped records.
export type Json = Record<string, unknown>;

export interface PropertyKnowledge {
  property: PropertyRow;
  /** Configurable access items (property_access_items), ordered. */
  access: Json[];
  connectivity: Json | null;
  tech_accounts: Json[];
  contacts: Json[];
  rooms: Json[];
  documents: Json[];
  warnings?: string[];
}

const PROPERTY_COLUMNS =
  'id, name, hostaway_name, hostaway_listing_id, is_active, address_street, address_city, address_state, address_zip, address_country, latitude, longitude, bedrooms, bathrooms, timezone, created_at, updated_at';

/**
 * Load the full property-knowledge dossier. Returns null when the property
 * doesn't exist. Throws on a hard error reading the property row; sub-section
 * read failures degrade gracefully (empty/null for that section plus a
 * `warnings` entry).
 */
export async function loadPropertyKnowledge(
  propertyId: string,
): Promise<PropertyKnowledge | null> {
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
    supabase.from('properties').select(PROPERTY_COLUMNS).eq('id', propertyId).maybeSingle(),
    supabase
      .from('property_access_items')
      .select('id, type, label, value, notes, sort_order')
      .eq('property_id', propertyId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase
      .from('property_connectivity')
      .select('*')
      .eq('property_id', propertyId)
      .maybeSingle(),
    supabase
      .from('property_tech_accounts')
      .select(
        `id, kind, service_name, username, password, notes, sort_order,
         property_tech_account_photos (id, storage_path, sort_order)`,
      )
      .eq('property_id', propertyId)
      .order('sort_order', { ascending: true }),
    supabase
      .from('property_contacts')
      .select('id, tags, name, role, phone, email, schedule, preferences, notes, sort_order')
      .eq('property_id', propertyId)
      .order('sort_order', { ascending: true }),
    supabase
      .from('property_rooms')
      .select(
        `id, scope, title, notes, sort_order,
         property_room_photos (id, storage_path, caption, sort_order),
         property_attributes (
           id, tags, title, body, sort_order,
           property_attribute_photos (id, storage_path, caption, sort_order)
         )`,
      )
      .eq('property_id', propertyId)
      .order('scope', { ascending: true })
      .order('sort_order', { ascending: true }),
    supabase
      .from('property_documents')
      .select(
        'id, tag, title, notes, storage_path, mime_type, size_bytes, original_filename, created_at',
      )
      .eq('property_id', propertyId)
      .order('tag', { ascending: true })
      .order('created_at', { ascending: false }),
  ]);

  if (propertyRes.error) {
    throw new Error(propertyRes.error.message);
  }
  if (!propertyRes.data) {
    return null;
  }

  const warnings: string[] = [];
  const note = (key: string, err: { message?: string } | null) => {
    if (err) warnings.push(`${key}: ${err.message || 'query failed'}`);
  };
  note('access', accessRes.error);
  note('connectivity', connectivityRes.error);
  note('tech_accounts', techAccountsRes.error);
  note('contacts', contactsRes.error);
  note('rooms', roomsRes.error);
  note('documents', docsRes.error);

  return {
    property: propertyRes.data as PropertyRow,
    access: accessRes.error ? [] : ((accessRes.data as Json[] | null) ?? []),
    connectivity: connectivityRes.error ? null : ((connectivityRes.data as Json | null) ?? null),
    tech_accounts: techAccountsRes.error ? [] : ((techAccountsRes.data as Json[] | null) ?? []),
    contacts: contactsRes.error ? [] : ((contactsRes.data as Json[] | null) ?? []),
    rooms: roomsRes.error ? [] : ((roomsRes.data as Json[] | null) ?? []),
    documents: docsRes.error ? [] : ((docsRes.data as Json[] | null) ?? []),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
