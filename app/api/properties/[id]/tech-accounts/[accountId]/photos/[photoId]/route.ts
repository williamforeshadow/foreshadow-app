import { NextRequest, NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/requireAuthContext';

export async function DELETE(
  _req: NextRequest,
  {
    params,
  }: {
    params: Promise<{ id: string; accountId: string; photoId: string }>;
  }
) {
  const ctx = await requireAuthContext();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;

  const { id, accountId, photoId } = await params;

  // Verify the ownership chain before we touch anything.
  const { data: photo, error: fetchErr } = await supabase
    .from('property_tech_account_photos')
    .select(
      'id, storage_path, account_id, property_tech_accounts!inner(id, property_id)'
    )
    .eq('id', photoId)
    .eq('account_id', accountId)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!photo) {
    return NextResponse.json({ error: 'Photo not found' }, { status: 404 });
  }

  const linkedPropertyId = (photo as any).property_tech_accounts?.property_id;
  if (linkedPropertyId && linkedPropertyId !== id) {
    return NextResponse.json({ error: 'Photo not found' }, { status: 404 });
  }

  const { error: deleteErr } = await supabase
    .from('property_tech_account_photos')
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
