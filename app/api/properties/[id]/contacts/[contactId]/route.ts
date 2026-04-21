import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

const CATEGORIES = new Set([
  'cleaning',
  'maintenance',
  'stakeholder',
  'emergency',
]);

const EDITABLE = ['name', 'role', 'phone', 'email', 'notes'] as const;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; contactId: string }> }
) {
  const { id, contactId } = await params;
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};

  for (const field of EDITABLE) {
    if (!(field in body)) continue;
    const v = body[field];
    if (v === null || v === undefined) {
      patch[field] = null;
      continue;
    }
    if (typeof v !== 'string') {
      return NextResponse.json(
        { error: `${field} must be a string` },
        { status: 400 }
      );
    }
    const trimmed = v.trim();
    if (field === 'name') {
      if (trimmed === '') {
        return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 });
      }
      patch[field] = trimmed;
    } else {
      patch[field] = trimmed === '' ? null : trimmed;
    }
  }

  if ('category' in body) {
    const c = body.category;
    if (typeof c !== 'string' || !CATEGORIES.has(c)) {
      return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
    }
    patch.category = c;
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
    .from('property_contacts')
    .update(patch)
    .eq('id', contactId)
    .eq('property_id', id)
    .select('*')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  }
  return NextResponse.json({ contact: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; contactId: string }> }
) {
  const { id, contactId } = await params;
  const supabase = getSupabaseServer();
  const { error } = await supabase
    .from('property_contacts')
    .delete()
    .eq('id', contactId)
    .eq('property_id', id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
