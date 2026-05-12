import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { getActorUserIdFromRequest } from '@/lib/getActorFromRequest';
import { notifyTaskStatusChanged } from '@/src/server/notifications/notify';

export async function POST(request: Request) {
  try {
    const { taskId, action } = await request.json();

    if (!taskId || !action) {
      return NextResponse.json({ error: 'Task ID and action are required' }, { status: 400 });
    }

    const allowedActions = ['contingent', 'not_started', 'in_progress', 'paused', 'complete'];
    if (!allowedActions.includes(action)) {
      return NextResponse.json({ error: 'Invalid action provided' }, { status: 400 });
    }

    const { data: existing } = await getSupabaseServer()
      .from('turnover_tasks')
      .select('status')
      .eq('id', taskId)
      .maybeSingle();

    // Keep completed_at in sync with status transitions so downstream
    // surfaces (bins auto-dismiss countdown, sweeps, reporting) work
    // regardless of which surface the user completed the task from. Mirrors
    // the same logic in PUT /api/tasks-for-bin/[id].
    const { data, error } = await getSupabaseServer()
      .from('turnover_tasks')
      .update({
        status: action,
        completed_at: action === 'complete' ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', taskId)
      .select()
      .single();

    if (error) {
      console.error('getSupabaseServer() error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (existing) {
      await notifyTaskStatusChanged({
        taskId,
        beforeStatus: existing.status ?? null,
        afterStatus: data.status ?? null,
        actor: { user_id: getActorUserIdFromRequest(request) },
      });
    }

    return NextResponse.json({ success: true, data }, { status: 200 });
  } catch (error: any) {
    console.error('API error:', error);
    return NextResponse.json({ error: error.message || 'An unexpected error occurred' }, { status: 500 });
  }
}

