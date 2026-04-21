import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

// DELETE removes the DB row + the underlying storage object so the
// bucket doesn't grow with orphans. Captions could be PATCHable later
// but aren't wired into the UI yet — keep the route simple for v1.

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; cardId: string; photoId: string }> }
) {
  const { id, cardId, photoId } = await params;
  const supabase = getSupabaseServer();

  // Verify ownership chain before deleting. Fetching via `card_id` + a
  // join on `property_cards` keeps one round-trip enough to validate.
  const { data: photo, error: fetchErr } = await supabase
    .from('property_card_photos')
    .select(
      'id, storage_path, card_id, property_cards!inner(id, property_id)'
    )
    .eq('id', photoId)
    .eq('card_id', cardId)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!photo) {
    return NextResponse.json({ error: 'Photo not found' }, { status: 404 });
  }

  const linkedPropertyId = (photo as any).property_cards?.property_id;
  if (linkedPropertyId && linkedPropertyId !== id) {
    return NextResponse.json({ error: 'Photo not found' }, { status: 404 });
  }

  const { error: deleteErr } = await supabase
    .from('property_card_photos')
    .delete()
    .eq('id', photoId);
  if (deleteErr) {
    return NextResponse.json({ error: deleteErr.message }, { status: 500 });
  }

  if (photo.storage_path) {
    await supabase.storage
      .from('property-photos')
      .remove([photo.storage_path]);
  }

  return NextResponse.json({ ok: true });
}
