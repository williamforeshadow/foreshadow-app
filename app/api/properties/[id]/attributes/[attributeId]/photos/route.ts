import { NextRequest, NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/requireAuthContext';

// POST multipart/form-data { file: File, caption?: string }
// Uploads to the `property-photos` public bucket under an unguessable
// path, then inserts a row in property_attribute_photos. Enforces a
// 20-photo cap per attribute and a 10MB size cap per file.

const MAX_PHOTOS = 20;
const MAX_BYTES = 10 * 1024 * 1024;

function randomSegment(len = 16) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; attributeId: string }> }
) {
  const ctx = await requireAuthContext();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, orgId } = ctx;

  const { id, attributeId } = await params;

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

  // Verify the attribute exists and belongs to this property before we
  // blow storage cycles uploading.
  const { data: attribute, error: attrErr } = await supabase
    .from('property_attributes')
    .select('id')
    .eq('id', attributeId)
    .eq('property_id', id)
    .maybeSingle();
  if (attrErr) {
    return NextResponse.json({ error: attrErr.message }, { status: 500 });
  }
  if (!attribute) {
    return NextResponse.json({ error: 'Attribute not found' }, { status: 404 });
  }

  // Enforce the 20-photo cap server-side in addition to the UI check.
  const { count, error: countErr } = await supabase
    .from('property_attribute_photos')
    .select('*', { count: 'exact', head: true })
    .eq('attribute_id', attributeId);
  if (countErr) {
    return NextResponse.json({ error: countErr.message }, { status: 500 });
  }
  if ((count ?? 0) >= MAX_PHOTOS) {
    return NextResponse.json(
      { error: `Photo limit reached (${MAX_PHOTOS} per attribute).` },
      { status: 409 }
    );
  }

  // Layout: properties/{propertyId}/attributes/{attributeId}/{random}.{ext}
  const ext =
    (file.name.match(/\.([a-zA-Z0-9]+)$/)?.[1] || 'jpg').toLowerCase();
  const token = randomSegment(16);
  const storagePath = `properties/${id}/attributes/${attributeId}/${token}.${ext}`;

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
    .from('property_attribute_photos')
    .insert({
      attribute_id: attributeId,
      storage_path: storagePath,
      caption,
      sort_order: count ?? 0,
      org_id: orgId,
    })
    .select('id, storage_path, caption, sort_order')
    .maybeSingle();

  if (insertErr || !photoRow) {
    // Roll back the storage object if the DB insert failed so we don't
    // leak orphaned files.
    await supabase.storage.from('property-photos').remove([storagePath]);
    return NextResponse.json(
      { error: insertErr?.message || 'Failed to record photo' },
      { status: 500 }
    );
  }

  return NextResponse.json({ photo: photoRow }, { status: 201 });
}
