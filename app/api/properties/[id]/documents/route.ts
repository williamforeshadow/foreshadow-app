import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

const DOCUMENT_TAGS = new Set([
  'lease',
  'appliance_manual',
  'inspection',
  'insurance',
  'other',
]);

const MAX_BYTES = 25 * 1024 * 1024; // 25MB per document

function randomSegment(len = 16) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// GET /api/properties/[id]/documents[?tag=lease]
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tag = req.nextUrl.searchParams.get('tag');

  const supabase = getSupabaseServer();
  let query = supabase
    .from('property_documents')
    .select('*')
    .eq('property_id', id)
    .order('created_at', { ascending: false });

  if (tag) {
    if (!DOCUMENT_TAGS.has(tag)) {
      return NextResponse.json({ error: 'Invalid tag' }, { status: 400 });
    }
    query = query.eq('tag', tag);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ documents: data || [] });
}

// POST multipart/form-data { file: File, tag: document_tag, title?: string, notes?: string }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const formData = await req.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: 'File exceeds 25MB limit' },
      { status: 400 }
    );
  }

  const tag = formData.get('tag');
  if (typeof tag !== 'string' || !DOCUMENT_TAGS.has(tag)) {
    return NextResponse.json({ error: 'tag is required' }, { status: 400 });
  }

  const titleRaw = formData.get('title');
  const title =
    typeof titleRaw === 'string' && titleRaw.trim() !== ''
      ? titleRaw.trim()
      : file.name;

  const notesRaw = formData.get('notes');
  const notes =
    typeof notesRaw === 'string' && notesRaw.trim() !== ''
      ? notesRaw.trim()
      : null;

  const supabase = getSupabaseServer();

  const { data: prop, error: propErr } = await supabase
    .from('properties')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (propErr) {
    return NextResponse.json({ error: propErr.message }, { status: 500 });
  }
  if (!prop) {
    return NextResponse.json({ error: 'Property not found' }, { status: 404 });
  }

  const ext =
    (file.name.match(/\.([a-zA-Z0-9]+)$/)?.[1] || 'bin').toLowerCase();
  const token = randomSegment(16);
  const storagePath = `properties/${id}/documents/${token}.${ext}`;

  const arrayBuf = await file.arrayBuffer();
  const { error: uploadErr } = await supabase.storage
    .from('property-documents')
    .upload(storagePath, arrayBuf, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });
  if (uploadErr) {
    return NextResponse.json({ error: uploadErr.message }, { status: 500 });
  }

  const { data: row, error: insertErr } = await supabase
    .from('property_documents')
    .insert({
      property_id: id,
      tag,
      title,
      notes,
      storage_path: storagePath,
      mime_type: file.type || null,
      size_bytes: file.size,
      original_filename: file.name,
    })
    .select('*')
    .maybeSingle();

  if (insertErr || !row) {
    await supabase.storage.from('property-documents').remove([storagePath]);
    return NextResponse.json(
      { error: insertErr?.message || 'Failed to record document' },
      { status: 500 }
    );
  }

  return NextResponse.json({ document: row }, { status: 201 });
}
