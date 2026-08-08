import { NextRequest, NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/requireAuthContext';
import { upsertPropertyPolicy } from '@/src/server/properties/upsertPropertyPolicy';

// Policies & Instructions — a flat, roomless collection of title+body rules and
// standing instructions that apply to the stay or the whole property.

// GET /api/properties/[id]/policies — list the property's policies (ordered).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAuthContext();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;

  const { id } = await params;
  const { data, error } = await supabase
    .from('property_policies')
    .select('*')
    .eq('property_id', id)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ policies: data || [] });
}

// POST /api/properties/[id]/policies — create a policy.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAuthContext();
  if (ctx instanceof NextResponse) return ctx;
  const { appUser } = ctx;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const result = await upsertPropertyPolicy({
    property_id: id,
    title: body?.title,
    body: body?.body,
    sort_order: body?.sort_order,
    actor_user_id: appUser.id,
    source: 'web',
  });
  if (!result.ok) {
    const status =
      result.error.code === 'not_found' ? 404 : result.error.code === 'invalid_input' ? 400 : 500;
    return NextResponse.json({ error: result.error.message }, { status });
  }
  return NextResponse.json({ policy: result.policy }, { status: 201 });
}
