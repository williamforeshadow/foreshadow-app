import { NextResponse, type NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/requireAuthContext';

// Concierge Training CRUD — update + delete a single rule. Property
// associations are replaced wholesale (delete-all-then-insert) when
// property_ids is provided in a PATCH.

// PATCH /api/concierge-training/[id]
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    const ctx = await requireAuthContext();
    if (ctx instanceof NextResponse) return ctx;
    const { supabase, orgId, appUser } = ctx;

    const body = await request.json();
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    update.updated_by_user_id = appUser.id;

    if (typeof body.title === 'string') {
      const title = body.title.trim();
      if (!title) {
        return NextResponse.json({ error: 'A title is required' }, { status: 400 });
      }
      update.title = title;
    }
    if (typeof body.instructions === 'string') update.instructions = body.instructions.trim();
    if (body.category === 'reply' || body.category === 'task') update.category = body.category;
    if (body.tier === 'always' || body.tier === 'situational') update.tier = body.tier;
    if (typeof body.is_active === 'boolean') update.is_active = body.is_active;
    if (typeof body.applies_to_all === 'boolean') update.applies_to_all = body.applies_to_all;
    if (typeof body.sort_order === 'number') update.sort_order = body.sort_order;

    const { data: rule, error } = await supabase
      .from('concierge_training')
      .update(update)
      .eq('id', id)
      .select('id, title, instructions, category, tier, applies_to_all, is_active, sort_order, created_at, updated_at')
      .single();
    if (error) {
      const status = error.code === 'PGRST116' ? 404 : 500;
      return NextResponse.json({ error: error.message }, { status });
    }

    // Replace associations only when the client sent an explicit list.
    let property_ids: string[] | undefined;
    if (Array.isArray(body.property_ids)) {
      const incoming = [
        ...new Set(
          (body.property_ids as unknown[]).filter((p): p is string => typeof p === 'string'),
        ),
      ];
      const { error: delErr } = await supabase
        .from('concierge_training_properties')
        .delete()
        .eq('training_id', id);
      if (delErr) {
        return NextResponse.json({ error: delErr.message }, { status: 500 });
      }
      // When applies_to_all is (or becomes) true, associations are irrelevant.
      const willApplyToAll =
        typeof body.applies_to_all === 'boolean'
          ? body.applies_to_all
          : Boolean(rule.applies_to_all);
      property_ids = willApplyToAll ? [] : incoming;
      if (property_ids.length > 0) {
        const { error: insErr } = await supabase
          .from('concierge_training_properties')
          .insert(property_ids.map((property_id) => ({ training_id: id, property_id, org_id: orgId })));
        if (insErr) {
          return NextResponse.json({ error: insErr.message }, { status: 500 });
        }
      }
    } else {
      // Untouched — return the current associations.
      const { data: links } = await supabase
        .from('concierge_training_properties')
        .select('property_id')
        .eq('training_id', id);
      property_ids = ((links ?? []) as Array<{ property_id: string }>).map((l) => l.property_id);
    }

    // Examples are managed via the dedicated sub-routes; echo the current set so
    // the returned rule has the same shape the list endpoint produces.
    const { data: exRows } = await supabase
      .from('concierge_training_examples')
      .select('id, label, transcript')
      .eq('training_id', id)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    const examples = ((exRows ?? []) as Array<{ id: string; label: string | null; transcript: string | null }>)
      .filter((e) => (e.transcript ?? '').trim())
      .map((e) => ({ id: e.id, label: e.label?.trim() || null, transcript: (e.transcript ?? '').trim() }));

    return NextResponse.json({ rule: { ...rule, property_ids, examples } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update rule';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/concierge-training/[id] — join rows cascade.
export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    const ctx = await requireAuthContext();
    if (ctx instanceof NextResponse) return ctx;
    const { supabase } = ctx;

    const { error } = await supabase
      .from('concierge_training')
      .delete()
      .eq('id', id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete rule';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
