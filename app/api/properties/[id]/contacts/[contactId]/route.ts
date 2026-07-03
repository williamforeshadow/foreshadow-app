import { NextRequest, NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/requireAuthContext';
import { logPropertyKnowledgeActivity } from '@/lib/logPropertyKnowledgeActivity';
import { normalizeContactTags } from '@/lib/propertyAttributes';

const EDITABLE = ['name', 'role', 'phone', 'email', 'schedule', 'preferences', 'notes'] as const;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; contactId: string }> }
) {
  const ctx = await requireAuthContext();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, appUser } = ctx;

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

  if ('tags' in body) {
    patch.tags = normalizeContactTags(body.tags);
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
  const actorUserId = appUser.id;
  if (actorUserId) {
    patch.updated_by_user_id = actorUserId;
  }

  // Pre-read for the activity diff.
  const { data: before } = await supabase
    .from('property_contacts')
    .select('id, tags, name, role, phone, email, schedule, preferences, notes, sort_order')
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
      'tags',
      'name',
      'role',
      'phone',
      'email',
      'schedule',
      'preferences',
      'notes',
      'sort_order',
    ] as const) {
      const b = (before as Record<string, unknown>)[f];
      const a = (data as Record<string, unknown>)[f];
      const changed =
        f === 'tags' ? JSON.stringify(b) !== JSON.stringify(a) : b !== a;
      if (changed) entries.push({ field: f, before: b, after: a });
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
  const ctx = await requireAuthContext();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, appUser } = ctx;

  const { id, contactId } = await params;

  const { data: before } = await supabase
    .from('property_contacts')
    .select('id, tags, name, role, phone, email')
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
    const actorUserId = appUser.id;
    await logPropertyKnowledgeActivity({
      property_id: id,
      user_id: actorUserId,
      resource_type: 'contact',
      resource_id: null,
      action: 'delete',
      changes: {
        kind: 'snapshot',
        row: {
          tags: before.tags,
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
