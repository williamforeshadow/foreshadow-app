import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { getActorUserIdFromRequest } from '@/lib/getActorFromRequest';
import { logPropertyKnowledgeActivity } from '@/lib/logPropertyKnowledgeActivity';

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
  const actorUserId = getActorUserIdFromRequest(req);
  if (actorUserId) {
    patch.updated_by_user_id = actorUserId;
  }

  const supabase = getSupabaseServer();

  // Read the existing row first so we can compute a per-field diff for
  // the activity ledger. One extra round-trip per PATCH is the price of
  // honest before/after capture; the alternative is logging only the
  // patched fields' new values which is lossy for the future ledger UI.
  const { data: before } = await supabase
    .from('property_notes')
    .select('id, scope, title, body, sort_order')
    .eq('id', noteId)
    .eq('property_id', id)
    .maybeSingle();

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

  if (before) {
    const entries: Array<{ field: string; before: unknown; after: unknown }> = [];
    for (const f of ['title', 'body', 'sort_order'] as const) {
      const b = (before as Record<string, unknown>)[f];
      const a = (data as Record<string, unknown>)[f];
      if (b !== a) entries.push({ field: f, before: b, after: a });
    }
    if (entries.length > 0) {
      await logPropertyKnowledgeActivity({
        property_id: id,
        user_id: actorUserId,
        resource_type: 'note',
        resource_id: data.id,
        action: 'update',
        changes: { kind: 'diff', entries },
        subject_label:
          data.title && data.title.trim() !== ''
            ? data.title
            : `${data.scope} note`,
        source: 'web',
      });
    }
  }

  return NextResponse.json({ note: data });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  const { id, noteId } = await params;
  const supabase = getSupabaseServer();

  // Snapshot the row before deletion so the ledger can render it after
  // the FK is gone.
  const { data: before } = await supabase
    .from('property_notes')
    .select('id, scope, title, body')
    .eq('id', noteId)
    .eq('property_id', id)
    .maybeSingle();

  const { error } = await supabase
    .from('property_notes')
    .delete()
    .eq('id', noteId)
    .eq('property_id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (before) {
    const actorUserId = getActorUserIdFromRequest(req);
    await logPropertyKnowledgeActivity({
      property_id: id,
      user_id: actorUserId,
      resource_type: 'note',
      resource_id: null,
      action: 'delete',
      changes: {
        kind: 'snapshot',
        row: { scope: before.scope, title: before.title, body: before.body },
      },
      subject_label:
        before.title && before.title.trim() !== ''
          ? before.title
          : `${before.scope} note`,
      source: 'web',
    });
  }

  return NextResponse.json({ ok: true });
}
