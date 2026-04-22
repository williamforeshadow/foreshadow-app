import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import {
  CARD_TAGS,
  normalizeTagData,
  type CardScope,
  type CardTag,
} from '@/lib/propertyCards';

// PATCH /api/properties/[id]/cards/[cardId]
// Editable: title, body, tag, tag_data, room_id, sort_order.
// Moving a card to another room is allowed (must still belong to the
// same property); the card's `scope` is re-derived from the new room.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; cardId: string }> }
) {
  const { id, cardId } = await params;
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  const supabase = getSupabaseServer();

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

  if ('body' in body) {
    const v = body.body;
    patch.body = typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
  }

  // Tag changes are allowed; tag_data is re-normalized against the new
  // tag below if either of them is being patched.
  let nextTag: CardTag | undefined;
  if ('tag' in body) {
    const v = body.tag;
    if (typeof v !== 'string' || !CARD_TAGS.includes(v as CardTag)) {
      return NextResponse.json({ error: 'Invalid tag' }, { status: 400 });
    }
    nextTag = v as CardTag;
    patch.tag = nextTag;
  }

  if ('tag_data' in body) {
    let t = nextTag;
    if (!t) {
      const { data: existing, error: exErr } = await supabase
        .from('property_cards')
        .select('tag')
        .eq('id', cardId)
        .eq('property_id', id)
        .maybeSingle();
      if (exErr) {
        return NextResponse.json({ error: exErr.message }, { status: 500 });
      }
      if (!existing) {
        return NextResponse.json({ error: 'Card not found' }, { status: 404 });
      }
      t = existing.tag as CardTag;
    }
    patch.tag_data = normalizeTagData(t, body.tag_data);
  }

  if ('room_id' in body) {
    const v = body.room_id;
    if (typeof v !== 'string' || !v) {
      return NextResponse.json(
        { error: 'room_id cannot be empty' },
        { status: 400 }
      );
    }
    const { data: room, error: roomErr } = await supabase
      .from('property_rooms')
      .select('id, scope')
      .eq('id', v)
      .eq('property_id', id)
      .maybeSingle();
    if (roomErr) {
      return NextResponse.json({ error: roomErr.message }, { status: 500 });
    }
    if (!room) {
      return NextResponse.json(
        { error: 'Target room not found' },
        { status: 400 }
      );
    }
    patch.room_id = v;
    patch.scope = room.scope as CardScope;
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

  const { data, error } = await supabase
    .from('property_cards')
    .update(patch)
    .eq('id', cardId)
    .eq('property_id', id)
    .select('*, property_card_photos(id, storage_path, caption, sort_order)')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Card not found' }, { status: 404 });
  }

  return NextResponse.json({ card: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; cardId: string }> }
) {
  const { id, cardId } = await params;
  const supabase = getSupabaseServer();

  // Grab storage paths before the cascade deletes the photo rows.
  const photosRes = await supabase
    .from('property_card_photos')
    .select('storage_path')
    .eq('card_id', cardId);
  const photos: Array<{ storage_path: string | null }> =
    (photosRes.data as Array<{ storage_path: string | null }> | null) ?? [];

  const { error } = await supabase
    .from('property_cards')
    .delete()
    .eq('id', cardId)
    .eq('property_id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (photos.length > 0) {
    const paths = photos
      .map((p) => p.storage_path)
      .filter((p): p is string => typeof p === 'string' && p.length > 0);
    if (paths.length > 0) {
      await supabase.storage.from('property-photos').remove(paths);
    }
  }

  return NextResponse.json({ ok: true });
}
