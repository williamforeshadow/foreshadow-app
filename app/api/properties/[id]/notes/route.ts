import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

const NOTE_SCOPES = new Set([
  'guest_facing',
  'team_facing',
  'owner_preferences',
  'known_issues',
  'local_tips',
]);

// GET /api/properties/[id]/notes[?scope=known_issues]
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const scope = req.nextUrl.searchParams.get('scope');

  const supabase = getSupabaseServer();
  let query = supabase
    .from('property_notes')
    .select('*')
    .eq('property_id', id)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (scope) {
    if (!NOTE_SCOPES.has(scope)) {
      return NextResponse.json({ error: 'Invalid scope' }, { status: 400 });
    }
    query = query.eq('scope', scope);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ notes: data || [] });
}

// POST /api/properties/[id]/notes
// Body: { scope: note_scope, title?: string, body: string, sort_order?: number }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const scope = typeof body?.scope === 'string' ? body.scope : '';
  if (!NOTE_SCOPES.has(scope)) {
    return NextResponse.json({ error: 'scope is required' }, { status: 400 });
  }

  const noteBody = typeof body?.body === 'string' ? body.body.trim() : '';
  if (!noteBody) {
    return NextResponse.json(
      { error: 'Note body cannot be empty' },
      { status: 400 }
    );
  }

  const title =
    typeof body?.title === 'string' && body.title.trim() !== ''
      ? body.title.trim()
      : null;

  const sortOrder =
    typeof body?.sort_order === 'number' && Number.isFinite(body.sort_order)
      ? Math.trunc(body.sort_order)
      : 0;

  const supabase = getSupabaseServer();

  // Confirm parent property exists for a clean 404
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

  const { data, error } = await supabase
    .from('property_notes')
    .insert({
      property_id: id,
      scope,
      title,
      body: noteBody,
      sort_order: sortOrder,
    })
    .select('*')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ note: data }, { status: 201 });
}
