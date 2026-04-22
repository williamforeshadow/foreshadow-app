import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import {
  CARD_TAGS,
  normalizeTagData,
  type CardScope,
  type CardTag,
} from '@/lib/propertyCards';

// GET /api/properties/[id]/cards[?room_id=…&scope=interior&tag=appliance]
// A flat cards list. Most callers should prefer GET
// /api/properties/[id]/rooms which already nests cards inside rooms in
// a single trip; this endpoint stays for agent/analytics use cases that
// want to scan cards across all rooms.
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
    .from('property_cards')
    .select('*, property_card_photos(id, storage_path, caption, sort_order)')
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
    if (!CARD_TAGS.includes(tag as CardTag)) {
      return NextResponse.json({ error: 'Invalid tag' }, { status: 400 });
    }
    query = query.eq('tag', tag);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ cards: data || [] });
}

// POST /api/properties/[id]/cards
// Required: room_id, tag, title
// Optional: body, tag_data (keyed by tag), sort_order
//
// The room's `scope` is copied onto the card server-side so we can
// still filter cards by scope without a join. `room_id` implies which
// property the card belongs to, but we still verify it matches [id]
// in the URL for defense-in-depth.
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
  const tag = typeof body?.tag === 'string' ? body.tag : '';
  if (!CARD_TAGS.includes(tag as CardTag)) {
    return NextResponse.json({ error: 'tag is required' }, { status: 400 });
  }
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  if (!title) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 });
  }

  const pickString = (v: unknown) =>
    typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

  const supabase = getSupabaseServer();

  // Validate the room belongs to this property and grab its scope for
  // denormalization onto the card row.
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

  const payload = {
    property_id: id,
    room_id: roomId,
    scope: room.scope as CardScope,
    tag,
    title,
    body: pickString(body?.body),
    tag_data: normalizeTagData(tag as CardTag, body?.tag_data),
    sort_order:
      typeof body?.sort_order === 'number' && Number.isFinite(body.sort_order)
        ? Math.trunc(body.sort_order)
        : 0,
  };

  const { data, error } = await supabase
    .from('property_cards')
    .insert(payload)
    .select('*, property_card_photos(id, storage_path, caption, sort_order)')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ card: data }, { status: 201 });
}
