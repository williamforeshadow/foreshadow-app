import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

// Whitelist of editable fields for property_access. Kept narrow so a
// client can't accidentally (or maliciously) set `property_id`,
// `updated_at`, or anything else server-owned.
const EDITABLE_FIELDS = [
  'guest_code',
  'cleaner_code',
  'backup_code',
  'code_rotation_notes',
  'outer_door_code',
  'gate_code',
  'elevator_notes',
  'parking_entry_instructions',
  'unit_door_code',
  'key_location',
  'lockbox_code',
  'wifi_ssid',
  'wifi_password',
  'wifi_router_location',
  'parking_spot_number',
  'parking_type',
  'parking_instructions',
  'parking_owner_vs_guest_notes',
] as const;

const PARKING_TYPES = new Set(['assigned', 'street', 'garage', 'other']);

// Empty-object default used on GET when no row exists yet. Matches what
// the client expects so it doesn't have to branch on 404 vs empty.
function emptyAccess(propertyId: string) {
  const out: Record<string, string | null> = { property_id: propertyId };
  for (const f of EDITABLE_FIELDS) out[f] = null;
  return out;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = getSupabaseServer();

  const { data, error } = await supabase
    .from('property_access')
    .select('*')
    .eq('property_id', id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ access: data ?? emptyAccess(id) });
}

// PUT: upsert the full row. Only whitelisted keys are persisted; empty
// strings are coerced to NULL so the DB stays clean for agent queries.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const payload: Record<string, string | null> = { property_id: id };
  for (const field of EDITABLE_FIELDS) {
    if (!(field in body)) continue;
    const v = body[field];
    if (v === null || v === undefined || v === '') {
      payload[field] = null;
      continue;
    }
    if (typeof v !== 'string') {
      return NextResponse.json(
        { error: `${field} must be a string` },
        { status: 400 }
      );
    }
    const trimmed = v.trim();
    if (trimmed === '') {
      payload[field] = null;
      continue;
    }
    if (field === 'parking_type' && !PARKING_TYPES.has(trimmed)) {
      return NextResponse.json(
        { error: 'parking_type must be one of: assigned, street, garage, other' },
        { status: 400 }
      );
    }
    payload[field] = trimmed;
  }

  const supabase = getSupabaseServer();

  // Ensure the parent property exists to give a clean 404 instead of a
  // confusing FK violation from Postgres.
  const { data: prop, error: propErr } = await supabase
    .from('properties')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (propErr) {
    return NextResponse.json({ error: propErr.message }, { status: 500 });
  }
  if (!prop) {
    return NextResponse.json({ error: 'Property not found' }, { status: 404 });
  }

  const { data, error } = await supabase
    .from('property_access')
    .upsert(
      { ...payload, updated_at: new Date().toISOString() },
      { onConflict: 'property_id' }
    )
    .select('*')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ access: data });
}
