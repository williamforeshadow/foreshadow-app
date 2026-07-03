import { NextRequest, NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/requireAuthContext';
import { logPropertyKnowledgeActivity } from '@/lib/logPropertyKnowledgeActivity';
import { normalizeTags, type AttributeScope } from '@/lib/propertyAttributes';

// PATCH /api/properties/[id]/attributes/[attributeId]
// Editable: title, body, tags, room_id, sort_order.
// Moving an attribute to another room is allowed (must still belong to the
// same property); the attribute's `scope` is re-derived from the new room.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; attributeId: string }> }
) {
  const ctx = await requireAuthContext();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, appUser } = ctx;

  const { id, attributeId } = await params;
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

  if ('body' in body) {
    const v = body.body;
    patch.body = typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
  }

  if ('tags' in body) {
    patch.tags = normalizeTags(body.tags);
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
    patch.scope = room.scope as AttributeScope;
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
  const actorUserId = appUser.id;
  if (actorUserId) {
    patch.updated_by_user_id = actorUserId;
  }

  const { data: before } = await supabase
    .from('property_attributes')
    .select('id, room_id, tags, title, body, sort_order')
    .eq('id', attributeId)
    .eq('property_id', id)
    .maybeSingle();

  const { data, error } = await supabase
    .from('property_attributes')
    .update(patch)
    .eq('id', attributeId)
    .eq('property_id', id)
    .select('*, property_attribute_photos(id, storage_path, caption, sort_order)')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Attribute not found' }, { status: 404 });
  }

  if (before) {
    const entries: Array<{ field: string; before: unknown; after: unknown }> = [];
    for (const f of ['room_id', 'tags', 'title', 'body', 'sort_order'] as const) {
      const b = (before as Record<string, unknown>)[f];
      const a = (data as Record<string, unknown>)[f];
      const changed =
        f === 'tags' ? JSON.stringify(b) !== JSON.stringify(a) : b !== a;
      if (changed) entries.push({ field: f, before: b, after: a });
    }
    if (entries.length > 0) {
      await logPropertyKnowledgeActivity({
        property_id: id,
        user_id: actorUserId,
        resource_type: 'attribute',
        resource_id: data.id,
        action: 'update',
        changes: { kind: 'diff', entries },
        subject_label: data.title || 'attribute',
        source: 'web',
      });
    }
  }

  return NextResponse.json({ attribute: data });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; attributeId: string }> }
) {
  const ctx = await requireAuthContext();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, appUser } = ctx;

  const { id, attributeId } = await params;

  // Snapshot the row + grab storage paths before the cascade fires.
  const [beforeRes, photosRes] = await Promise.all([
    supabase
      .from('property_attributes')
      .select('id, room_id, tags, title, body')
      .eq('id', attributeId)
      .eq('property_id', id)
      .maybeSingle(),
    supabase
      .from('property_attribute_photos')
      .select('storage_path')
      .eq('attribute_id', attributeId),
  ]);
  const before = beforeRes.data;
  const photos: Array<{ storage_path: string | null }> =
    (photosRes.data as Array<{ storage_path: string | null }> | null) ?? [];

  const { error } = await supabase
    .from('property_attributes')
    .delete()
    .eq('id', attributeId)
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
    const actorUserId = appUser.id;
    await logPropertyKnowledgeActivity({
      property_id: id,
      user_id: actorUserId,
      resource_type: 'attribute',
      resource_id: null,
      action: 'delete',
      changes: {
        kind: 'snapshot',
        row: {
          room_id: before.room_id,
          tags: before.tags,
          title: before.title,
          body: before.body,
        },
      },
      subject_label: before.title || 'attribute',
      source: 'web',
    });
  }

  return NextResponse.json({ ok: true });
}
