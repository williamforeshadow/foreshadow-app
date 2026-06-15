import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { getActorUserIdFromRequest } from '@/lib/getActorFromRequest';
import { logPropertyKnowledgeActivity } from '@/lib/logPropertyKnowledgeActivity';
import {
  ATTRIBUTE_TAGS,
  normalizeTags,
  type AttributeScope,
  type AttributeTag,
} from '@/lib/propertyAttributes';

// GET /api/properties/[id]/attributes[?room_id=…&scope=interior&tag=appliance]
// A flat attributes list. Most callers should prefer GET
// /api/properties/[id]/rooms which already nests attributes inside rooms in
// a single trip; this endpoint stays for agent/analytics use cases that want
// to scan attributes across all rooms. `tag` filters by membership in the
// multi-tag array.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const roomId = req.nextUrl.searchParams.get('room_id');
  const scope = req.nextUrl.searchParams.get('scope');
  const tag = req.nextUrl.searchParams.get('tag');

  const supabase = getSupabaseServer();
  let query = supabase
    .from('property_attributes')
    .select('*, property_attribute_photos(id, storage_path, caption, sort_order)')
    .eq('property_id', id)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (roomId) {
    query = query.eq('room_id', roomId);
  }
  if (scope) {
    if (scope !== 'interior' && scope !== 'exterior') {
      return NextResponse.json({ error: 'Invalid scope' }, { status: 400 });
    }
    query = query.eq('scope', scope);
  }
  if (tag) {
    if (!ATTRIBUTE_TAGS.includes(tag as AttributeTag)) {
      return NextResponse.json({ error: 'Invalid tag' }, { status: 400 });
    }
    query = query.contains('tags', [tag]);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ attributes: data || [] });
}

// POST /api/properties/[id]/attributes
// Required: room_id, title
// Optional: tags (array), body, sort_order
//
// The room's `scope` is copied onto the attribute server-side so we can
// still filter by scope without a join.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const roomId = typeof body?.room_id === 'string' ? body.room_id : '';
  if (!roomId) {
    return NextResponse.json({ error: 'room_id is required' }, { status: 400 });
  }
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  if (!title) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 });
  }

  const pickString = (v: unknown) =>
    typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

  const supabase = getSupabaseServer();

  // Validate the room belongs to this property and grab its scope for
  // denormalization onto the attribute row.
  const { data: room, error: roomErr } = await supabase
    .from('property_rooms')
    .select('id, scope, property_id')
    .eq('id', roomId)
    .eq('property_id', id)
    .maybeSingle();
  if (roomErr) {
    return NextResponse.json({ error: roomErr.message }, { status: 500 });
  }
  if (!room) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  }

  const actorUserId = getActorUserIdFromRequest(req);

  const payload = {
    property_id: id,
    room_id: roomId,
    scope: room.scope as AttributeScope,
    tags: normalizeTags(body?.tags),
    title,
    body: pickString(body?.body),
    sort_order:
      typeof body?.sort_order === 'number' && Number.isFinite(body.sort_order)
        ? Math.trunc(body.sort_order)
        : 0,
    created_by_user_id: actorUserId,
    updated_by_user_id: actorUserId,
  };

  const { data, error } = await supabase
    .from('property_attributes')
    .insert(payload)
    .select('*, property_attribute_photos(id, storage_path, caption, sort_order)')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (data) {
    await logPropertyKnowledgeActivity({
      property_id: id,
      user_id: actorUserId,
      resource_type: 'attribute',
      resource_id: data.id,
      action: 'create',
      changes: {
        kind: 'snapshot',
        row: {
          room_id: data.room_id,
          tags: data.tags,
          title: data.title,
          body: data.body,
        },
      },
      subject_label: data.title || 'attribute',
      source: 'web',
    });
  }

  return NextResponse.json({ attribute: data }, { status: 201 });
}
