import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import {
  CARD_CATEGORIES,
  CARD_SCOPES,
  normalizeCategoryData,
  type CardCategory,
  type CardScope,
} from '@/lib/propertyCards';

// GET /api/properties/[id]/cards[?scope=interior&group=Kitchen&category=appliance]
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const scope = req.nextUrl.searchParams.get('scope');
  const group = req.nextUrl.searchParams.get('group');
  const category = req.nextUrl.searchParams.get('category');

  const supabase = getSupabaseServer();
  let query = supabase
    .from('property_cards')
    .select('*, property_card_photos(id, storage_path, caption, sort_order)')
    .eq('property_id', id)
    .order('group_label', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (scope) {
    if (!CARD_SCOPES.has(scope as CardScope)) {
      return NextResponse.json({ error: 'Invalid scope' }, { status: 400 });
    }
    query = query.eq('scope', scope);
  }
  if (group) {
    query = query.eq('group_label', group);
  }
  if (category) {
    if (!CARD_CATEGORIES.has(category as CardCategory)) {
      return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
    }
    query = query.eq('category', category);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ cards: data || [] });
}

// POST /api/properties/[id]/cards
// Required: scope, group_label, category, title
// Optional: location, body, category_data (keyed by category)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const scope = typeof body?.scope === 'string' ? body.scope : '';
  if (!CARD_SCOPES.has(scope as CardScope)) {
    return NextResponse.json({ error: 'scope is required' }, { status: 400 });
  }
  const groupLabel =
    typeof body?.group_label === 'string' ? body.group_label.trim() : '';
  if (!groupLabel) {
    return NextResponse.json(
      { error: 'group_label is required' },
      { status: 400 }
    );
  }
  const category = typeof body?.category === 'string' ? body.category : '';
  if (!CARD_CATEGORIES.has(category as CardCategory)) {
    return NextResponse.json({ error: 'category is required' }, { status: 400 });
  }
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  if (!title) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 });
  }

  const pickString = (v: unknown) =>
    typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

  const payload = {
    property_id: id,
    scope,
    group_label: groupLabel,
    category,
    title,
    location: pickString(body?.location),
    body: pickString(body?.body),
    category_data: normalizeCategoryData(category as CardCategory, body?.category_data),
    sort_order:
      typeof body?.sort_order === 'number' && Number.isFinite(body.sort_order)
        ? Math.trunc(body.sort_order)
        : 0,
  };

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

  const { data, error } = await supabase
    .from('property_cards')
    .insert(payload)
    .select('*, property_card_photos(id, storage_path, caption, sort_order)')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ card: data }, { status: 201 });
}
