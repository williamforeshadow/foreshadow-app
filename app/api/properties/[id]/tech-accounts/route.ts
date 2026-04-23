import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import {
  TECH_ACCOUNT_KINDS,
  DEFAULT_TECH_ACCOUNT_KIND,
  DEFAULT_TECH_ACCOUNT_SERVICE_NAME,
  type TechAccountKind,
} from '@/lib/propertyTechAccounts';

// GET: list all tech accounts for a property, with nested photos.
// POST: create a new account. Both `kind` and `service_name` are optional
// so the UI can call POST with no body for a plain "+ Add account".

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = getSupabaseServer();

  const { data, error } = await supabase
    .from('property_tech_accounts')
    .select(
      `
      *,
      property_tech_account_photos (id, storage_path, sort_order)
      `
    )
    .eq('property_id', id)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ accounts: data ?? [] });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  let kind: TechAccountKind = DEFAULT_TECH_ACCOUNT_KIND;
  if ('kind' in body && body.kind != null) {
    if (
      typeof body.kind !== 'string' ||
      !TECH_ACCOUNT_KINDS.includes(body.kind as TechAccountKind)
    ) {
      return NextResponse.json({ error: 'Invalid kind' }, { status: 400 });
    }
    kind = body.kind as TechAccountKind;
  }

  let service_name = DEFAULT_TECH_ACCOUNT_SERVICE_NAME;
  if ('service_name' in body && body.service_name != null) {
    if (typeof body.service_name !== 'string') {
      return NextResponse.json(
        { error: 'service_name must be a string' },
        { status: 400 }
      );
    }
    const trimmed = body.service_name.trim();
    if (trimmed !== '') service_name = trimmed;
  }

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

  // Append-to-end sort order so new accounts land at the bottom of the
  // list regardless of how many are already there.
  const { count } = await supabase
    .from('property_tech_accounts')
    .select('*', { count: 'exact', head: true })
    .eq('property_id', id);

  const { data, error } = await supabase
    .from('property_tech_accounts')
    .insert({
      property_id: id,
      kind,
      service_name,
      sort_order: count ?? 0,
    })
    .select(
      `
      *,
      property_tech_account_photos (id, storage_path, sort_order)
      `
    )
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message || 'Failed to create account' },
      { status: 500 }
    );
  }

  return NextResponse.json({ account: data }, { status: 201 });
}
