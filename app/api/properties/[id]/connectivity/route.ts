import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { getActorUserIdFromRequest } from '@/lib/getActorFromRequest';
import { logPropertyKnowledgeActivity } from '@/lib/logPropertyKnowledgeActivity';

// Singleton-style, one row per property in `property_connectivity`.
// Mirrors the shape of /api/properties/[id]/access — explicit PUT with a
// whitelist + empty-string-to-NULL normalization.

const EDITABLE_FIELDS = [
  'wifi_ssid',
  'wifi_password',
  'wifi_router_location',
] as const;

function emptyConnectivity(propertyId: string) {
  const out: Record<string, string | null> = { property_id: propertyId };
  for (const f of EDITABLE_FIELDS) out[f] = null;
  return out;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = getSupabaseServer();

  const { data, error } = await supabase
    .from('property_connectivity')
    .select('*')
    .eq('property_id', id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ connectivity: data ?? emptyConnectivity(id) });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const payload: Record<string, string | null> = { property_id: id };
  for (const field of EDITABLE_FIELDS) {
    if (!(field in body)) continue;
    const v = body[field];
    if (v === null || v === undefined || v === '') {
      payload[field] = null;
      continue;
    }
    if (typeof v !== 'string') {
      return NextResponse.json(
        { error: `${field} must be a string` },
        { status: 400 }
      );
    }
    const trimmed = v.trim();
    payload[field] = trimmed === '' ? null : trimmed;
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

  const actorUserId = getActorUserIdFromRequest(req);

  // Pre-read for create/update disambiguation + per-field diff. See
  // /access route for the same pattern.
  const { data: before } = await supabase
    .from('property_connectivity')
    .select('*')
    .eq('property_id', id)
    .maybeSingle();

  const upsertPayload: Record<string, unknown> = {
    ...payload,
    updated_at: new Date().toISOString(),
    updated_by_user_id: actorUserId,
  };
  if (!before) {
    upsertPayload.created_by_user_id = actorUserId;
  }

  const { data, error } = await supabase
    .from('property_connectivity')
    .upsert(upsertPayload, { onConflict: 'property_id' })
    .select('*')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (data) {
    if (!before) {
      const snapshot: Record<string, unknown> = {};
      for (const f of EDITABLE_FIELDS) snapshot[f] = (data as Record<string, unknown>)[f];
      await logPropertyKnowledgeActivity({
        property_id: id,
        user_id: actorUserId,
        resource_type: 'connectivity',
        resource_id: data.id ?? null,
        action: 'create',
        changes: { kind: 'snapshot', row: snapshot },
        subject_label: 'Connectivity info',
        source: 'web',
      });
    } else {
      const entries: Array<{ field: string; before: unknown; after: unknown }> =
        [];
      for (const f of EDITABLE_FIELDS) {
        const b = (before as Record<string, unknown>)[f];
        const a = (data as Record<string, unknown>)[f];
        if (b !== a) entries.push({ field: f, before: b, after: a });
      }
      if (entries.length > 0) {
        await logPropertyKnowledgeActivity({
          property_id: id,
          user_id: actorUserId,
          resource_type: 'connectivity',
          resource_id: data.id ?? null,
          action: 'update',
          changes: { kind: 'diff', entries },
          subject_label: 'Connectivity info',
          source: 'web',
        });
      }
    }
  }

  return NextResponse.json({ connectivity: data });
}
