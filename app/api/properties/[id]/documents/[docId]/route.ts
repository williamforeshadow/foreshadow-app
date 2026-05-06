import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { getActorUserIdFromRequest } from '@/lib/getActorFromRequest';
import { logPropertyKnowledgeActivity } from '@/lib/logPropertyKnowledgeActivity';

const DOCUMENT_TAGS = new Set([
  'lease',
  'appliance_manual',
  'inspection',
  'insurance',
  'other',
]);

// PATCH — edits metadata (title, notes, tag). The file itself is
// immutable; to replace, delete + re-upload.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  const { id, docId } = await params;
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};

  if ('title' in body) {
    const v = body.title;
    if (typeof v !== 'string' || v.trim() === '') {
      return NextResponse.json({ error: 'Title cannot be empty' }, { status: 400 });
    }
    patch.title = v.trim();
  }
  if ('notes' in body) {
    const v = body.notes;
    patch.notes = typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
  }
  if ('tag' in body) {
    const v = body.tag;
    if (typeof v !== 'string' || !DOCUMENT_TAGS.has(v)) {
      return NextResponse.json({ error: 'Invalid tag' }, { status: 400 });
    }
    patch.tag = v;
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

  const { data: before } = await supabase
    .from('property_documents')
    .select('id, tag, title, notes, original_filename')
    .eq('id', docId)
    .eq('property_id', id)
    .maybeSingle();

  const { data, error } = await supabase
    .from('property_documents')
    .update(patch)
    .eq('id', docId)
    .eq('property_id', id)
    .select('*')
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  }

  if (before) {
    const entries: Array<{ field: string; before: unknown; after: unknown }> = [];
    for (const f of ['tag', 'title', 'notes'] as const) {
      const b = (before as Record<string, unknown>)[f];
      const a = (data as Record<string, unknown>)[f];
      if (b !== a) entries.push({ field: f, before: b, after: a });
    }
    if (entries.length > 0) {
      await logPropertyKnowledgeActivity({
        property_id: id,
        user_id: actorUserId,
        resource_type: 'document',
        resource_id: data.id,
        action: 'update',
        changes: { kind: 'diff', entries },
        subject_label:
          data.title || data.original_filename || `${data.tag} document`,
        source: 'web',
      });
    }
  }

  return NextResponse.json({ document: data });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  const { id, docId } = await params;
  const supabase = getSupabaseServer();

  const { data: doc, error: fetchErr } = await supabase
    .from('property_documents')
    .select('id, storage_path, tag, title, notes, original_filename, size_bytes')
    .eq('id', docId)
    .eq('property_id', id)
    .maybeSingle();
  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!doc) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  }

  const { error: deleteErr } = await supabase
    .from('property_documents')
    .delete()
    .eq('id', docId)
    .eq('property_id', id);
  if (deleteErr) {
    return NextResponse.json({ error: deleteErr.message }, { status: 500 });
  }

  if (doc.storage_path) {
    await supabase.storage
      .from('property-documents')
      .remove([doc.storage_path]);
  }

  const actorUserId = getActorUserIdFromRequest(req);
  await logPropertyKnowledgeActivity({
    property_id: id,
    user_id: actorUserId,
    resource_type: 'document',
    resource_id: null,
    action: 'delete',
    changes: {
      kind: 'snapshot',
      row: {
        tag: doc.tag,
        title: doc.title,
        notes: doc.notes,
        original_filename: doc.original_filename,
        size_bytes: doc.size_bytes,
      },
    },
    subject_label: doc.title || doc.original_filename || `${doc.tag} document`,
    source: 'web',
  });

  return NextResponse.json({ ok: true });
}
