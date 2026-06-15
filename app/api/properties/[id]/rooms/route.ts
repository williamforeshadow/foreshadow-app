import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { getActorUserIdFromRequest } from '@/lib/getActorFromRequest';
import { logPropertyKnowledgeActivity } from '@/lib/logPropertyKnowledgeActivity';
import { ATTRIBUTE_SCOPES, type AttributeScope } from '@/lib/propertyAttributes';

const DEFAULT_ROOM_TITLE = 'New room';

// GET /api/properties/[id]/rooms[?scope=interior]
// Returns rooms (optionally scope-filtered), each with nested
// property_room_photos and property_cards (each card also carrying its
// own property_card_photos). One round-trip is enough to render a whole
// Interior or Exterior tab.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const scope = req.nextUrl.searchParams.get('scope');

  const supabase = getSupabaseServer();
  let query = supabase
    .from('property_rooms')
    .select(
      `
      *,
      property_room_photos (id, storage_path, caption, sort_order),
      property_attributes (
        *,
        property_attribute_photos (id, storage_path, caption, sort_order)
      )
      `
    )
    .eq('property_id', id)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (scope) {
    if (!ATTRIBUTE_SCOPES.has(scope as AttributeScope)) {
      return NextResponse.json({ error: 'Invalid scope' }, { status: 400 });
    }
    query = query.eq('scope', scope);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ rooms: data || [] });
}

// POST /api/properties/[id]/rooms
// Required: scope
// Optional: title (defaults to "New room"), notes, sort_order
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const scope = typeof body?.scope === 'string' ? body.scope : '';
  if (!ATTRIBUTE_SCOPES.has(scope as AttributeScope)) {
    return NextResponse.json({ error: 'scope is required' }, { status: 400 });
  }
  const titleRaw = typeof body?.title === 'string' ? body.title.trim() : '';
  const title = titleRaw || DEFAULT_ROOM_TITLE;

  // Optional notes blob attached at the room level. Empty/whitespace
  // becomes NULL so the column reads cleanly when nothing was set.
  let notes: string | null = null;
  if ('notes' in body) {
    const raw = body.notes;
    if (raw === null || raw === undefined) {
      notes = null;
    } else if (typeof raw !== 'string') {
      return NextResponse.json(
        { error: 'notes must be a string' },
        { status: 400 }
      );
    } else {
      const trimmed = raw.trim();
      notes = trimmed === '' ? null : trimmed;
    }
  }

  const supabase = getSupabaseServer();

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

  const actorUserId = getActorUserIdFromRequest(req);

  const payload = {
    property_id: id,
    scope,
    title,
    notes,
    sort_order:
      typeof body?.sort_order === 'number' && Number.isFinite(body.sort_order)
        ? Math.trunc(body.sort_order)
        : 0,
    created_by_user_id: actorUserId,
    updated_by_user_id: actorUserId,
  };

  const { data, error } = await supabase
    .from('property_rooms')
    .insert(payload)
    .select(
      `
      *,
      property_room_photos (id, storage_path, caption, sort_order),
      property_attributes (
        *,
        property_attribute_photos (id, storage_path, caption, sort_order)
      )
      `
    )
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (data) {
    await logPropertyKnowledgeActivity({
      property_id: id,
      user_id: actorUserId,
      resource_type: 'room',
      resource_id: data.id,
      action: 'create',
      changes: {
        kind: 'snapshot',
        row: {
          scope: data.scope,
          title: data.title,
          notes: data.notes,
        },
      },
      subject_label: data.title || `${data.scope} room`,
      source: 'web',
    });
  }

  return NextResponse.json({ room: data }, { status: 201 });
}
