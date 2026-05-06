import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { getActorUserIdFromRequest } from '@/lib/getActorFromRequest';
import { logPropertyKnowledgeActivity } from '@/lib/logPropertyKnowledgeActivity';
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
  const actorUserId = getActorUserIdFromRequest(req);
  if (actorUserId) {
    patch.updated_by_user_id = actorUserId;
  }

  const { data: before } = await supabase
    .from('property_cards')
    .select('id, room_id, tag, title, body, tag_data, sort_order')
    .eq('id', cardId)
    .eq('property_id', id)
    .maybeSingle();

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

  if (before) {
    const entries: Array<{ field: string; before: unknown; after: unknown }> = [];
    for (const f of [
      'room_id',
      'tag',
      'title',
      'body',
      'tag_data',
      'sort_order',
    ] as const) {
      const b = (before as Record<string, unknown>)[f];
      const a = (data as Record<string, unknown>)[f];
      // tag_data is a json blob; compare via JSON.stringify to avoid
      // false-positive diff entries from object identity differences.
      const changed =
        f === 'tag_data' ? JSON.stringify(b) !== JSON.stringify(a) : b !== a;
      if (changed) entries.push({ field: f, before: b, after: a });
    }
    if (entries.length > 0) {
      await logPropertyKnowledgeActivity({
        property_id: id,
        user_id: actorUserId,
        resource_type: 'card',
        resource_id: data.id,
        action: 'update',
        changes: { kind: 'diff', entries },
        subject_label: data.title || `${data.tag} card`,
        source: 'web',
      });
    }
  }

  return NextResponse.json({ card: data });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; cardId: string }> }
) {
  const { id, cardId } = await params;
  const supabase = getSupabaseServer();

  // Snapshot the row + grab storage paths before the cascade fires.
  const [beforeRes, photosRes] = await Promise.all([
    supabase
      .from('property_cards')
      .select('id, room_id, tag, title, body')
      .eq('id', cardId)
      .eq('property_id', id)
      .maybeSingle(),
    supabase
      .from('property_card_photos')
      .select('storage_path')
      .eq('card_id', cardId),
  ]);
  const before = beforeRes.data;
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

  if (before) {
    const actorUserId = getActorUserIdFromRequest(req);
    await logPropertyKnowledgeActivity({
      property_id: id,
      user_id: actorUserId,
      resource_type: 'card',
      resource_id: null,
      action: 'delete',
      changes: {
        kind: 'snapshot',
        row: {
          room_id: before.room_id,
          tag: before.tag,
          title: before.title,
          body: before.body,
        },
      },
      subject_label: before.title || `${before.tag} card`,
      source: 'web',
    });
  }

  return NextResponse.json({ ok: true });
}
