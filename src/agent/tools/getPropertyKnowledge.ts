import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabaseServer';
import type { ToolDefinition, ToolResult } from './types';

// get_property_knowledge — full per-property dossier.
//
// Mirrors the existing /api/properties/[id]/brief endpoint: one round-trip
// pulls every "Knowledge" section the UI exposes (info, access, connectivity,
// tech accounts, vendors, notes, rooms+cards, documents). Photos return as
// metadata only (storage_path); no signed URLs or binary content.
//
// The model is expected to call find_properties first to resolve a name into
// a property_id, then call this tool exactly once per property.

const inputSchema = z.object({
  property_id: z
    .string()
    .uuid()
    .describe('Canonical property UUID. Use find_properties to resolve a name into an id.'),
});

type Input = z.infer<typeof inputSchema>;

interface PropertyRow {
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
  created_at: string;
  updated_at: string;
}

// Sub-section payloads are wide and column-stable but evolve faster than the
// agent contract should care about, so we let them flow through as opaque
// JSON-shaped records. The model reads field names directly from the data.
type Json = Record<string, unknown>;

export interface PropertyKnowledge {
  property: PropertyRow;
  access: Json | null;
  connectivity: Json | null;
  tech_accounts: Json[];
  notes: Json[];
  contacts: Json[];
  rooms: Json[];
  documents: Json[];
  warnings?: string[];
}

const PROPERTY_COLUMNS =
  'id, name, hostaway_name, hostaway_listing_id, is_active, address_street, address_city, address_state, address_zip, address_country, latitude, longitude, bedrooms, bathrooms, created_at, updated_at';

async function handler(input: Input): Promise<ToolResult<PropertyKnowledge>> {
  const supabase = getSupabaseServer();
  const { property_id } = input;

  // 8 parallel reads — same set the brief endpoint uses. Ordering inside each
  // collection mirrors the UI so the agent sees rows in the same order a user
  // sees them in the Knowledge tabs.
  const [
    propertyRes,
    accessRes,
    connectivityRes,
    techAccountsRes,
    notesRes,
    contactsRes,
    roomsRes,
    docsRes,
  ] = await Promise.all([
    supabase
      .from('properties')
      .select(PROPERTY_COLUMNS)
      .eq('id', property_id)
      .maybeSingle(),
    supabase
      .from('property_access')
      .select('*')
      .eq('property_id', property_id)
      .maybeSingle(),
    supabase
      .from('property_connectivity')
      .select('*')
      .eq('property_id', property_id)
      .maybeSingle(),
    supabase
      .from('property_tech_accounts')
      .select(
        `id, kind, service_name, username, password, notes, sort_order,
         property_tech_account_photos (id, storage_path, sort_order)`,
      )
      .eq('property_id', property_id)
      .order('sort_order', { ascending: true }),
    supabase
      .from('property_notes')
      .select('id, scope, title, body, sort_order, updated_at')
      .eq('property_id', property_id)
      .order('scope', { ascending: true })
      .order('sort_order', { ascending: true }),
    supabase
      .from('property_contacts')
      .select('id, category, name, role, phone, email, notes, sort_order')
      .eq('property_id', property_id)
      .order('category', { ascending: true })
      .order('sort_order', { ascending: true }),
    supabase
      .from('property_rooms')
      .select(
        `id, scope, type, title, sort_order,
         property_room_photos (id, storage_path, caption, sort_order),
         property_cards (
           id, tag, title, body, tag_data, sort_order,
           property_card_photos (id, storage_path, caption, sort_order)
         )`,
      )
      .eq('property_id', property_id)
      .order('scope', { ascending: true })
      .order('sort_order', { ascending: true }),
    supabase
      .from('property_documents')
      .select(
        'id, tag, title, notes, storage_path, mime_type, size_bytes, original_filename, created_at',
      )
      .eq('property_id', property_id)
      .order('tag', { ascending: true })
      .order('created_at', { ascending: false }),
  ]);

  // Property miss vs DB error — distinct outcomes for the model.
  if (propertyRes.error) {
    return {
      ok: false,
      error: { code: 'db_error', message: propertyRes.error.message },
    };
  }
  if (!propertyRes.data) {
    return {
      ok: false,
      error: {
        code: 'not_found',
        message: `No property found with id ${property_id}`,
        hint: 'Use find_properties to look up a valid property id by name.',
      },
    };
  }

  // Sub-query failures degrade gracefully: empty/null for that section plus a
  // warning the agent can mention. Matches /api/properties/[id]/brief.
  const warnings: string[] = [];
  const note = (key: string, err: { message?: string } | null) => {
    if (err) warnings.push(`${key}: ${err.message || 'query failed'}`);
  };
  note('access', accessRes.error);
  note('connectivity', connectivityRes.error);
  note('tech_accounts', techAccountsRes.error);
  note('notes', notesRes.error);
  note('contacts', contactsRes.error);
  note('rooms', roomsRes.error);
  note('documents', docsRes.error);

  const data: PropertyKnowledge = {
    property: propertyRes.data as PropertyRow,
    access: accessRes.error ? null : ((accessRes.data as Json | null) ?? null),
    connectivity: connectivityRes.error
      ? null
      : ((connectivityRes.data as Json | null) ?? null),
    tech_accounts: techAccountsRes.error
      ? []
      : ((techAccountsRes.data as Json[] | null) ?? []),
    notes: notesRes.error ? [] : ((notesRes.data as Json[] | null) ?? []),
    contacts: contactsRes.error
      ? []
      : ((contactsRes.data as Json[] | null) ?? []),
    rooms: roomsRes.error ? [] : ((roomsRes.data as Json[] | null) ?? []),
    documents: docsRes.error ? [] : ((docsRes.data as Json[] | null) ?? []),
    ...(warnings.length > 0 ? { warnings } : {}),
  };

  return { ok: true, data };
}

export const getPropertyKnowledge: ToolDefinition<Input, PropertyKnowledge> = {
  name: 'get_property_knowledge',
  description:
    'Fetch everything Foreshadow knows about a single property in one call: profile (address, beds/baths, Hostaway link), access codes and parking, wifi and tech-account credentials, vendor contacts, free-text notes, interior + exterior rooms with cards, and documents. Use after find_properties has resolved a name into a property_id. Photos return as storage paths only.',
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      property_id: {
        type: 'string',
        description:
          'Canonical property UUID. Resolve names to ids with find_properties first.',
      },
    },
    required: ['property_id'],
    additionalProperties: false,
  },
  handler,
};
