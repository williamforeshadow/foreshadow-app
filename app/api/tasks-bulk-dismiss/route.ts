import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

// Dismiss one or more tasks from their bins by setting is_binned=false and
// bin_id=null. Works for any status (complete or not) — the caller decides
// which tasks to pass. Returns the ids that were actually updated so the
// client can reconcile local state.
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { taskIds } = body as { taskIds?: unknown };

    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      return NextResponse.json(
        { error: 'taskIds must be a non-empty array of task ids' },
        { status: 400 }
      );
    }

    const cleaned = taskIds.filter(
      (id): id is string => typeof id === 'string' && id.length > 0
    );

    if (cleaned.length === 0) {
      return NextResponse.json(
        { error: 'taskIds must contain at least one valid string id' },
        { status: 400 }
      );
    }

    // Cap bulk operations to a sane upper bound to protect the DB.
    if (cleaned.length > 500) {
      return NextResponse.json(
        { error: 'Cannot dismiss more than 500 tasks in a single request' },
        { status: 400 }
      );
    }

    const { data, error } = await getSupabaseServer()
      .from('turnover_tasks')
      .update({
        is_binned: false,
        bin_id: null,
        updated_at: new Date().toISOString(),
      })
      .in('id', cleaned)
      .select('id');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const dismissedIds = (data || []).map((row: { id: string }) => row.id);

    return NextResponse.json({
      success: true,
      dismissed_count: dismissedIds.length,
      dismissed_ids: dismissedIds,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to dismiss tasks';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
