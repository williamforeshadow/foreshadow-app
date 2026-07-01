import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { getCurrentAppUser } from '@/src/server/users/currentUser';

// PATCH + DELETE /api/concierge-training/[id]/examples/[exampleId] — edit or
// remove one worked example from a training block. Scoped by training_id so an
// example can only be touched through its own block.

// PATCH — update an example's label and/or transcript.
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; exampleId: string }> },
) {
  const { error: authError } = await getCurrentAppUser();
  if (authError === 'unauthenticated') {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const { id, exampleId } = await context.params;

  try {
    const body = await request.json();
    const update: Record<string, unknown> = {};
    if (typeof body.label === 'string') update.label = body.label.trim() || null;
    else if (body.label === null) update.label = null;
    if (typeof body.transcript === 'string') {
      const transcript = body.transcript.trim();
      if (!transcript) {
        return NextResponse.json({ error: 'An example transcript is required' }, { status: 400 });
      }
      update.transcript = transcript;
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const { data: row, error } = await getSupabaseServer()
      .from('concierge_training_examples')
      .update(update)
      .eq('id', exampleId)
      .eq('training_id', id)
      .select('id, label, transcript')
      .single();
    if (error) {
      const status = error.code === 'PGRST116' ? 404 : 500;
      return NextResponse.json({ error: error.message }, { status });
    }

    return NextResponse.json({
      example: { id: row.id, label: row.label?.trim() || null, transcript: row.transcript },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update example';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string; exampleId: string }> },
) {
  const { error: authError } = await getCurrentAppUser();
  if (authError === 'unauthenticated') {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const { id, exampleId } = await context.params;

  try {
    const { error } = await getSupabaseServer()
      .from('concierge_training_examples')
      .delete()
      .eq('id', exampleId)
      .eq('training_id', id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete example';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
