import { NextRequest, NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/requireAuthContext';
import { upsertPropertyAccessItem } from '@/src/server/properties/upsertPropertyAccessItem';

// Access is a configurable collection of items (property_access_items), replacing
// the old fixed-column property_access singleton.

// GET /api/properties/[id]/access — list the property's access items (ordered).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAuthContext();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;

  const { id } = await params;
  const { data, error } = await supabase
    .from('property_access_items')
    .select('*')
    .eq('property_id', id)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ items: data || [] });
}

// POST /api/properties/[id]/access — create an access item.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAuthContext();
  if (ctx instanceof NextResponse) return ctx;
  const { appUser } = ctx;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const result = await upsertPropertyAccessItem({
    property_id: id,
    type: body?.type,
    label: body?.label,
    value: body?.value,
    notes: body?.notes,
    sort_order: body?.sort_order,
    actor_user_id: appUser.id,
    source: 'web',
  });
  if (!result.ok) {
    const status =
      result.error.code === 'not_found' ? 404 : result.error.code === 'invalid_input' ? 400 : 500;
    return NextResponse.json({ error: result.error.message }, { status });
  }
  return NextResponse.json({ item: result.item }, { status: 201 });
}
