import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

// DELETE /api/automations/attachments/[id]
//
// Removes an attachment from Supabase Storage. Used when the user removes a
// file from an automation's attachment list, or cancels without saving
// (orphan cleanup).
//
// `id` is the random token portion of the storage path (no extension). We
// list the bucket prefix to find the exact file (extension is variable)
// and delete it.
//
// (Bucket keeps its historical name `slack-automation-attachments`.)

const BUCKET = 'slack-automation-attachments';
const ID_RE = /^[a-f0-9]{32}$/;

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!ID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid attachment id' }, { status: 400 });
  }

  const supabase = getSupabaseServer();

  const { data: files, error: listErr } = await supabase.storage
    .from(BUCKET)
    .list('', { limit: 1000, search: id });

  if (listErr) {
    console.error('[api/automations/attachments] list failed', listErr);
    return NextResponse.json({ error: listErr.message }, { status: 500 });
  }

  const matches = ((files ?? []) as Array<{ name: string }>)
    .map((f) => f.name)
    .filter((name) => name.startsWith(`${id}.`));

  if (matches.length === 0) {
    return NextResponse.json({ success: true, removed: 0 });
  }

  const { error: removeErr } = await supabase.storage
    .from(BUCKET)
    .remove(matches);

  if (removeErr) {
    console.error('[api/automations/attachments] remove failed', removeErr);
    return NextResponse.json({ error: removeErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, removed: matches.length });
}
