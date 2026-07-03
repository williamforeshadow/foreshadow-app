import { NextResponse, type NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/requireAuthContext';

// POST /api/concierge-training/[id]/examples — append one worked example to an
// existing training block. Used by "Add to existing block" (promote a
// conversation onto a block the operator already has) and the editor's add-example
// action. New examples sort after the existing ones.

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    const ctx = await requireAuthContext();
    if (ctx instanceof NextResponse) return ctx;
    const { supabase, orgId, appUser } = ctx;

    const body = await request.json();
    const transcript = typeof body.transcript === 'string' ? body.transcript.trim() : '';
    if (!transcript) {
      return NextResponse.json({ error: 'An example transcript is required' }, { status: 400 });
    }
    const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim() : null;
    const sourceConversationId =
      typeof body.source_conversation_id === 'string' && body.source_conversation_id.trim()
        ? body.source_conversation_id.trim()
        : null;

    // Confirm the parent exists so we return 404 (not a silent orphan insert).
    const { data: parent, error: parentErr } = await supabase
      .from('concierge_training')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    if (parentErr) {
      return NextResponse.json({ error: parentErr.message }, { status: 500 });
    }
    if (!parent) {
      return NextResponse.json({ error: 'Training block not found' }, { status: 404 });
    }

    // Sort the new example after the current ones.
    const { count } = await supabase
      .from('concierge_training_examples')
      .select('id', { count: 'exact', head: true })
      .eq('training_id', id);

    const { data: row, error } = await supabase
      .from('concierge_training_examples')
      .insert({
        training_id: id,
        label,
        transcript,
        source_conversation_id: sourceConversationId,
        sort_order: count ?? 0,
        created_by_user_id: appUser.id,
        org_id: orgId,
      })
      .select('id, label, transcript')
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(
      { example: { id: row.id, label: row.label?.trim() || null, transcript: row.transcript } },
      { status: 201 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to add example';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
