import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

// DELETE removes the DB row + the underlying storage object so the
// bucket doesn't grow with orphans.

export async function DELETE(
  _req: NextRequest,
  {
    params,
  }: { params: Promise<{ id: string; roomId: string; photoId: string }> }
) {
  const { id, roomId, photoId } = await params;
  const supabase = getSupabaseServer();

  const { data: photo, error: fetchErr } = await supabase
    .from('property_room_photos')
    .select(
      'id, storage_path, room_id, property_rooms!inner(id, property_id)'
    )
    .eq('id', photoId)
    .eq('room_id', roomId)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!photo) {
    return NextResponse.json({ error: 'Photo not found' }, { status: 404 });
  }

  const linkedPropertyId = (photo as any).property_rooms?.property_id;
  if (linkedPropertyId && linkedPropertyId !== id) {
    return NextResponse.json({ error: 'Photo not found' }, { status: 404 });
  }

  const { error: deleteErr } = await supabase
    .from('property_room_photos')
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
