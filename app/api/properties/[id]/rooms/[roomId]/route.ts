import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { getActorUserIdFromRequest } from '@/lib/getActorFromRequest';
import { logPropertyKnowledgeActivity } from '@/lib/logPropertyKnowledgeActivity';
import { ROOM_TYPES, type RoomType } from '@/lib/propertyCards';

// PATCH /api/properties/[id]/rooms/[roomId]
// Editable: title, type, notes, sort_order. scope is immutable — moving
// a room from interior to exterior doesn't make sense semantically, and
// if it ever does the caller can delete + recreate.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; roomId: string }> }
) {
  const { id, roomId } = await params;
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};

  if ('title' in body) {
    const v = body.title;
    if (typeof v !== 'string' || v.trim() === '') {
      return NextResponse.json(
        { error: 'Title cannot be empty' },
        { status: 400 }
      );
    }
    patch.title = v.trim();
  }

  if ('type' in body) {
    const v = body.type;
    if (typeof v !== 'string' || !ROOM_TYPES.includes(v as RoomType)) {
      return NextResponse.json({ error: 'Invalid room type' }, { status: 400 });
    }
    patch.type = v;
  }

  // Notes is a free-text blob describing the whole room (separate from
  // per-card body text). Empty/whitespace clears the field.
  if ('notes' in body) {
    const v = body.notes;
    if (v === null || v === undefined) {
      patch.notes = null;
    } else if (typeof v !== 'string') {
      return NextResponse.json(
        { error: 'notes must be a string' },
        { status: 400 }
      );
    } else {
      const trimmed = v.trim();
      patch.notes = trimmed === '' ? null : trimmed;
    }
  }

  if ('sort_order' in body) {
    const v = body.sort_order;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return NextResponse.json(
        { error: 'sort_order must be a number' },
        { status: 400 }
      );
    }
    patch.sort_order = Math.trunc(v);
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: 'No valid fields to update' },
      { status: 400 }
    );
  }

  patch.updated_at = new Date().toISOString();
  const actorUserId = getActorUserIdFromRequest(req);
  if (actorUserId) {
    patch.updated_by_user_id = actorUserId;
  }

  const supabase = getSupabaseServer();

  const { data: before } = await supabase
    .from('property_rooms')
    .select('id, title, type, notes, sort_order')
    .eq('id', roomId)
    .eq('property_id', id)
    .maybeSingle();

  const { data, error } = await supabase
    .from('property_rooms')
    .update(patch)
    .eq('id', roomId)
    .eq('property_id', id)
    .select(
      `
      *,
      property_room_photos (id, storage_path, caption, sort_order),
      property_cards (
        *,
        property_card_photos (id, storage_path, caption, sort_order)
      )
      `
    )
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  }

  if (before) {
    const entries: Array<{ field: string; before: unknown; after: unknown }> = [];
    for (const f of ['title', 'type', 'notes', 'sort_order'] as const) {
      const b = (before as Record<string, unknown>)[f];
      const a = (data as Record<string, unknown>)[f];
      if (b !== a) entries.push({ field: f, before: b, after: a });
    }
    if (entries.length > 0) {
      await logPropertyKnowledgeActivity({
        property_id: id,
        user_id: actorUserId,
        resource_type: 'room',
        resource_id: data.id,
        action: 'update',
        changes: { kind: 'diff', entries },
        subject_label: data.title || 'Room',
        source: 'web',
      });
    }
  }

  return NextResponse.json({ room: data });
}

// DELETE cascades through property_cards, property_card_photos, and
// property_room_photos via FK ON DELETE CASCADE. We still have to clean
// up bucket objects manually because Postgres cascades don't reach
// Supabase Storage.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; roomId: string }> }
) {
  const { id, roomId } = await params;
  const supabase = getSupabaseServer();

  // Verify the room belongs to this property before we start listing
  // storage objects. We pull title/type/notes here for the ledger
  // snapshot — one extra column read is cheap.
  const { data: room, error: roomErr } = await supabase
    .from('property_rooms')
    .select('id, scope, type, title, notes')
    .eq('id', roomId)
    .eq('property_id', id)
    .maybeSingle();
  if (roomErr) {
    return NextResponse.json({ error: roomErr.message }, { status: 500 });
  }
  if (!room) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  }

  // Collect every storage path we'll need to evict: room photos +
  // every card photo for every card in the room.
  const roomPhotosRes = await supabase
    .from('property_room_photos')
    .select('storage_path')
    .eq('room_id', roomId);
  const roomPhotos: Array<{ storage_path: string | null }> =
    (roomPhotosRes.data as Array<{ storage_path: string | null }> | null) ?? [];

  const { data: cardRows } = await supabase
    .from('property_cards')
    .select('id')
    .eq('room_id', roomId);
  const cardIds = (cardRows || []).map((c: { id: string }) => c.id);

  let cardPhotos: Array<{ storage_path: string | null }> = [];
  if (cardIds.length > 0) {
    const cardPhotosRes = await supabase
      .from('property_card_photos')
      .select('storage_path')
      .in('card_id', cardIds);
    cardPhotos =
      (cardPhotosRes.data as Array<{ storage_path: string | null }> | null) ?? [];
  }

  const { error: delErr } = await supabase
    .from('property_rooms')
    .delete()
    .eq('id', roomId)
    .eq('property_id', id);
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  const paths = [...roomPhotos, ...cardPhotos]
    .map((p) => p.storage_path)
    .filter((p): p is string => typeof p === 'string' && p.length > 0);
  if (paths.length > 0) {
    await supabase.storage.from('property-photos').remove(paths);
  }

  const actorUserId = getActorUserIdFromRequest(req);
  await logPropertyKnowledgeActivity({
    property_id: id,
    user_id: actorUserId,
    resource_type: 'room',
    resource_id: null,
    action: 'delete',
    changes: {
      kind: 'snapshot',
      row: {
        scope: room.scope,
        type: room.type,
        title: room.title,
        notes: room.notes,
      },
    },
    subject_label: room.title || `${room.scope} room`,
    source: 'web',
  });

  return NextResponse.json({ ok: true });
}
