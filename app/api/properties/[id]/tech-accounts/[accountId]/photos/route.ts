import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

// POST multipart/form-data { file: File }
// Uploads to the `property-photos` public bucket under an unguessable
// path, then inserts a row in property_tech_account_photos. Enforces a
// 10-photo cap per account and 10MB size cap per file (matches client).

const MAX_PHOTOS = 10;
const MAX_BYTES = 10 * 1024 * 1024;

function randomSegment(len = 16) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> }
) {
  const { id, accountId } = await params;

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

  const supabase = getSupabaseServer();

  const { data: account, error: accountErr } = await supabase
    .from('property_tech_accounts')
    .select('id')
    .eq('id', accountId)
    .eq('property_id', id)
    .maybeSingle();
  if (accountErr) {
    return NextResponse.json({ error: accountErr.message }, { status: 500 });
  }
  if (!account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  const { count, error: countErr } = await supabase
    .from('property_tech_account_photos')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', accountId);
  if (countErr) {
    return NextResponse.json({ error: countErr.message }, { status: 500 });
  }
  if ((count ?? 0) >= MAX_PHOTOS) {
    return NextResponse.json(
      { error: `Photo limit reached (${MAX_PHOTOS} per account).` },
      { status: 409 }
    );
  }

  const ext =
    (file.name.match(/\.([a-zA-Z0-9]+)$/)?.[1] || 'jpg').toLowerCase();
  const token = randomSegment(16);
  const storagePath = `properties/${id}/tech-accounts/${accountId}/${token}.${ext}`;

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
    .from('property_tech_account_photos')
    .insert({
      account_id: accountId,
      storage_path: storagePath,
      sort_order: count ?? 0,
    })
    .select('id, storage_path, sort_order')
    .maybeSingle();

  if (insertErr || !photoRow) {
    await supabase.storage.from('property-photos').remove([storagePath]);
    return NextResponse.json(
      { error: insertErr?.message || 'Failed to record photo' },
      { status: 500 }
    );
  }

  // PhotoGrid expects a `caption` field — we don't persist captions for
  // tech-account photos in v1, but returning it as null keeps the type
  // uniform across photo surfaces.
  return NextResponse.json(
    { photo: { ...photoRow, caption: null } },
    { status: 201 }
  );
}
