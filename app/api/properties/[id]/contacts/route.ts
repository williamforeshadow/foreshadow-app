import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { getActorUserIdFromRequest } from '@/lib/getActorFromRequest';
import { logPropertyKnowledgeActivity } from '@/lib/logPropertyKnowledgeActivity';
import { CONTACT_TAG_SET, normalizeContactTags, type ContactTag } from '@/lib/propertyAttributes';

// GET /api/properties/[id]/contacts[?tag=cleaning]
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tag = req.nextUrl.searchParams.get('tag');

  const supabase = getSupabaseServer();
  let query = supabase
    .from('property_contacts')
    .select('*')
    .eq('property_id', id)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (tag) {
    if (!CONTACT_TAG_SET.has(tag as ContactTag)) {
      return NextResponse.json({ error: 'Invalid tag' }, { status: 400 });
    }
    query = query.contains('tags', [tag]);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ contacts: data || [] });
}

// POST — create. name required; tags + everything else optional.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  }

  const pickString = (v: unknown) =>
    typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

  const actorUserId = getActorUserIdFromRequest(req);

  const payload = {
    property_id: id,
    tags: normalizeContactTags(body?.tags),
    name,
    role: pickString(body?.role),
    phone: pickString(body?.phone),
    email: pickString(body?.email),
    schedule: pickString(body?.schedule),
    preferences: pickString(body?.preferences),
    notes: pickString(body?.notes),
    sort_order:
      typeof body?.sort_order === 'number' && Number.isFinite(body.sort_order)
        ? Math.trunc(body.sort_order)
        : 0,
    created_by_user_id: actorUserId,
    updated_by_user_id: actorUserId,
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
    .from('property_contacts')
    .insert(payload)
    .select('*')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (data) {
    await logPropertyKnowledgeActivity({
      property_id: id,
      user_id: actorUserId,
      resource_type: 'contact',
      resource_id: data.id,
      action: 'create',
      changes: {
        kind: 'snapshot',
        row: {
          tags: data.tags,
          name: data.name,
          role: data.role,
          phone: data.phone,
          email: data.email,
          schedule: data.schedule,
        },
      },
      subject_label:
        data.role && data.role.trim() !== ''
          ? `${data.name} (${data.role})`
          : data.name,
      source: 'web',
    });
  }

  return NextResponse.json({ contact: data }, { status: 201 });
}
