import { NextRequest, NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/requireAuthContext';

// DELETE removes the DB row + the underlying storage object so the bucket
// doesn't grow with orphans.

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; attributeId: string; photoId: string }> }
) {
  const ctx = await requireAuthContext();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;

  const { id, attributeId, photoId } = await params;

  // Verify ownership chain before deleting. Fetching via `attribute_id` + a
  // join on `property_attributes` keeps one round-trip enough to validate.
  const { data: photo, error: fetchErr } = await supabase
    .from('property_attribute_photos')
    .select(
      'id, storage_path, attribute_id, property_attributes!inner(id, property_id)'
    )
    .eq('id', photoId)
    .eq('attribute_id', attributeId)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!photo) {
    return NextResponse.json({ error: 'Photo not found' }, { status: 404 });
  }

  const linkedPropertyId = (photo as any).property_attributes?.property_id;
  if (linkedPropertyId && linkedPropertyId !== id) {
    return NextResponse.json({ error: 'Photo not found' }, { status: 404 });
  }

  const { error: deleteErr } = await supabase
    .from('property_attribute_photos')
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
