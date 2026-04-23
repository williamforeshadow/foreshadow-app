import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import {
  TECH_ACCOUNT_KINDS,
  type TechAccountKind,
} from '@/lib/propertyTechAccounts';

// PATCH: partial update. Whitelist of editable fields keeps the client
// from smuggling server-owned columns (property_id, created_at, etc.)
// through the body.
const TEXT_FIELDS = ['service_name', 'username', 'password', 'notes'] as const;
type TextField = (typeof TEXT_FIELDS)[number];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> }
) {
  const { id, accountId } = await params;
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};

  if ('kind' in body) {
    if (
      typeof body.kind !== 'string' ||
      !TECH_ACCOUNT_KINDS.includes(body.kind as TechAccountKind)
    ) {
      return NextResponse.json({ error: 'Invalid kind' }, { status: 400 });
    }
    patch.kind = body.kind;
  }

  for (const field of TEXT_FIELDS) {
    if (!(field in body)) continue;
    const v = body[field as TextField];
    // service_name is NOT NULL — reject both null/undefined and empty string.
    if (v === null || v === undefined) {
      if (field === 'service_name') {
        return NextResponse.json(
          { error: 'service_name cannot be null' },
          { status: 400 }
        );
      }
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
    if (field === 'service_name') {
      if (trimmed === '') {
        return NextResponse.json(
          { error: 'service_name cannot be empty' },
          { status: 400 }
        );
      }
      patch.service_name = trimmed;
    } else {
      patch[field] = trimmed === '' ? null : trimmed;
    }
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
    return NextResponse.json(
      { error: 'No valid fields to update' },
      { status: 400 }
    );
  }

  patch.updated_at = new Date().toISOString();

  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from('property_tech_accounts')
    .update(patch)
    .eq('id', accountId)
    .eq('property_id', id)
    .select(
      `
      *,
      property_tech_account_photos (id, storage_path, sort_order)
      `
    )
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }
  return NextResponse.json({ account: data });
}

// DELETE cascades through property_tech_account_photos via FK
// ON DELETE CASCADE, but we still need to clean up the bucket manually.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> }
) {
  const { id, accountId } = await params;
  const supabase = getSupabaseServer();

  const { data: account, error: accountErr } = await supabase
    .from('property_tech_accounts')
    .select('id')
    .eq('id', accountId)
    .eq('property_id', id)
    .maybeSingle();
  if (accountErr) {
    return NextResponse.json({ error: accountErr.message }, { status: 500 });
  }
  if (!account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  const photosRes = await supabase
    .from('property_tech_account_photos')
    .select('storage_path')
    .eq('account_id', accountId);
  const photos: Array<{ storage_path: string | null }> =
    (photosRes.data as Array<{ storage_path: string | null }> | null) ?? [];

  const { error: delErr } = await supabase
    .from('property_tech_accounts')
    .delete()
    .eq('id', accountId)
    .eq('property_id', id);
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  const paths = photos
    .map((p) => p.storage_path)
    .filter((p): p is string => typeof p === 'string' && p.length > 0);
  if (paths.length > 0) {
    await supabase.storage.from('property-photos').remove(paths);
  }

  return NextResponse.json({ ok: true });
}
