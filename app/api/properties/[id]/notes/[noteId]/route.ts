import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

// PATCH /api/properties/[id]/notes/[noteId]
// Editable: title, body, sort_order. scope is intentionally immutable —
// moving a note across scopes is rare and has tricky UX; we'd handle it
// as a delete + create if it ever comes up.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  const { id, noteId } = await params;
  const body = await req.json().catch(() => ({}));

  const patch: Record<string, unknown> = {};

  if ('title' in body) {
    const v = body.title;
    patch.title =
      typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
  }

  if ('body' in body) {
    const v = body.body;
    if (typeof v !== 'string' || v.trim() === '') {
      return NextResponse.json(
        { error: 'Note body cannot be empty' },
        { status: 400 }
      );
    }
    patch.body = v.trim();
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
    .from('property_notes')
    .update(patch)
    .eq('id', noteId)
    .eq('property_id', id)
    .select('*')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Note not found' }, { status: 404 });
  }

  return NextResponse.json({ note: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  const { id, noteId } = await params;
  const supabase = getSupabaseServer();
  const { error } = await supabase
    .from('property_notes')
    .delete()
    .eq('id', noteId)
    .eq('property_id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
