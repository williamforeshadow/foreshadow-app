import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import {
  CARD_CATEGORIES,
  normalizeCategoryData,
  type CardCategory,
} from '@/lib/propertyCards';

// PATCH /api/properties/[id]/cards/[cardId]
// Editable: title, location, body, group_label, category, category_data,
// sort_order. scope is immutable (interior vs exterior is a structural
// property of the card).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; cardId: string }> }
) {
  const { id, cardId } = await params;
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};

  if ('title' in body) {
    const v = body.title;
    if (typeof v !== 'string' || v.trim() === '') {
      return NextResponse.json({ error: 'Title cannot be empty' }, { status: 400 });
    }
    patch.title = v.trim();
  }

  if ('location' in body) {
    const v = body.location;
    patch.location =
      typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
  }

  if ('body' in body) {
    const v = body.body;
    patch.body = typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
  }

  if ('group_label' in body) {
    const v = body.group_label;
    if (typeof v !== 'string' || v.trim() === '') {
      return NextResponse.json(
        { error: 'group_label cannot be empty' },
        { status: 400 }
      );
    }
    patch.group_label = v.trim();
  }

  // Category changes are allowed; we'll re-normalize category_data
  // against the new category below.
  let nextCategory: CardCategory | undefined;
  if ('category' in body) {
    const v = body.category;
    if (typeof v !== 'string' || !CARD_CATEGORIES.has(v as CardCategory)) {
      return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
    }
    nextCategory = v as CardCategory;
    patch.category = nextCategory;
  }

  if ('category_data' in body) {
    // If category is also being patched we validate against the new
    // category; otherwise fetch the existing row's category.
    let cat = nextCategory;
    if (!cat) {
      const supabase = getSupabaseServer();
      const { data: existing, error: exErr } = await supabase
        .from('property_cards')
        .select('category')
        .eq('id', cardId)
        .eq('property_id', id)
        .maybeSingle();
      if (exErr) {
        return NextResponse.json({ error: exErr.message }, { status: 500 });
      }
      if (!existing) {
        return NextResponse.json({ error: 'Card not found' }, { status: 404 });
      }
      cat = existing.category as CardCategory;
    }
    patch.category_data = normalizeCategoryData(cat, body.category_data);
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
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  patch.updated_at = new Date().toISOString();

  const supabase = getSupabaseServer();
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

  // Best-effort: also clean up storage objects for any photos on this
  // card. The DB has ON DELETE CASCADE on property_card_photos, so the
  // rows go away automatically — but the actual bucket objects are
  // independent of Postgres cascades and have to be deleted manually.
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
