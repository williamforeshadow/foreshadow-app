import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { getActorUserIdFromRequest } from '@/lib/getActorFromRequest';
import { logPropertyKnowledgeActivity } from '@/lib/logPropertyKnowledgeActivity';

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
  const actorUserId = getActorUserIdFromRequest(req);
  if (actorUserId) {
    patch.updated_by_user_id = actorUserId;
  }

  const supabase = getSupabaseServer();

  // Pre-read for the activity diff. Same trade-off as the notes PATCH.
  const { data: before } = await supabase
    .from('property_contacts')
    .select('id, category, name, role, phone, email, notes, sort_order')
    .eq('id', contactId)
    .eq('property_id', id)
    .maybeSingle();

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

  if (before) {
    const entries: Array<{ field: string; before: unknown; after: unknown }> = [];
    for (const f of [
      'category',
      'name',
      'role',
      'phone',
      'email',
      'notes',
      'sort_order',
    ] as const) {
      const b = (before as Record<string, unknown>)[f];
      const a = (data as Record<string, unknown>)[f];
      if (b !== a) entries.push({ field: f, before: b, after: a });
    }
    if (entries.length > 0) {
      await logPropertyKnowledgeActivity({
        property_id: id,
        user_id: actorUserId,
        resource_type: 'contact',
        resource_id: data.id,
        action: 'update',
        changes: { kind: 'diff', entries },
        subject_label:
          data.role && data.role.trim() !== ''
            ? `${data.name} (${data.role})`
            : data.name,
        source: 'web',
      });
    }
  }

  return NextResponse.json({ contact: data });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; contactId: string }> }
) {
  const { id, contactId } = await params;
  const supabase = getSupabaseServer();

  const { data: before } = await supabase
    .from('property_contacts')
    .select('id, category, name, role, phone, email')
    .eq('id', contactId)
    .eq('property_id', id)
    .maybeSingle();

  const { error } = await supabase
    .from('property_contacts')
    .delete()
    .eq('id', contactId)
    .eq('property_id', id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (before) {
    const actorUserId = getActorUserIdFromRequest(req);
    await logPropertyKnowledgeActivity({
      property_id: id,
      user_id: actorUserId,
      resource_type: 'contact',
      resource_id: null,
      action: 'delete',
      changes: {
        kind: 'snapshot',
        row: {
          category: before.category,
          name: before.name,
          role: before.role,
          phone: before.phone,
          email: before.email,
        },
      },
      subject_label:
        before.role && before.role.trim() !== ''
          ? `${before.name} (${before.role})`
          : before.name,
      source: 'web',
    });
  }

  return NextResponse.json({ ok: true });
}
