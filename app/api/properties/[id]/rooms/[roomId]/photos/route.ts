import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

// POST multipart/form-data { file: File, caption?: string }
// Uploads to the `property-photos` public bucket under an unguessable
// path, then inserts a row in property_room_photos. Rooms collect more
// photos than cards, so the cap is higher.

const MAX_PHOTOS = 50;
const MAX_BYTES = 10 * 1024 * 1024;

function randomSegment(len = 16) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; roomId: string }> }
) {
  const { id, roomId } = await params;

  const formData = await req.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }
  if (!file.type.startsWith('image/')) {
    return NextResponse.json(
      { error: 'Only image files are allowed' },
      { status: 400 }
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: 'File exceeds 10MB limit' },
      { status: 400 }
    );
  }
  const captionRaw = formData.get('caption');
  const caption =
    typeof captionRaw === 'string' && captionRaw.trim() !== ''
      ? captionRaw.trim()
      : null;

  const supabase = getSupabaseServer();

  const { data: room, error: roomErr } = await supabase
    .from('property_rooms')
    .select('id')
    .eq('id', roomId)
    .eq('property_id', id)
    .maybeSingle();
  if (roomErr) {
    return NextResponse.json({ error: roomErr.message }, { status: 500 });
  }
  if (!room) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  }

  const { count, error: countErr } = await supabase
    .from('property_room_photos')
    .select('*', { count: 'exact', head: true })
    .eq('room_id', roomId);
  if (countErr) {
    return NextResponse.json({ error: countErr.message }, { status: 500 });
  }
  if ((count ?? 0) >= MAX_PHOTOS) {
    return NextResponse.json(
      { error: `Photo limit reached (${MAX_PHOTOS} per room).` },
      { status: 409 }
    );
  }

  const ext =
    (file.name.match(/\.([a-zA-Z0-9]+)$/)?.[1] || 'jpg').toLowerCase();
  const token = randomSegment(16);
  const storagePath = `properties/${id}/rooms/${roomId}/${token}.${ext}`;

  const arrayBuf = await file.arrayBuffer();
  const { error: uploadErr } = await supabase.storage
    .from('property-photos')
    .upload(storagePath, arrayBuf, {
      contentType: file.type,
      upsert: false,
    });
  if (uploadErr) {
    return NextResponse.json({ error: uploadErr.message }, { status: 500 });
  }

  const { data: photoRow, error: insertErr } = await supabase
    .from('property_room_photos')
    .insert({
      room_id: roomId,
      storage_path: storagePath,
      caption,
      sort_order: count ?? 0,
    })
    .select('id, storage_path, caption, sort_order')
    .maybeSingle();

  if (insertErr || !photoRow) {
    await supabase.storage.from('property-photos').remove([storagePath]);
    return NextResponse.json(
      { error: insertErr?.message || 'Failed to record photo' },
      { status: 500 }
    );
  }

  return NextResponse.json({ photo: photoRow }, { status: 201 });
}
