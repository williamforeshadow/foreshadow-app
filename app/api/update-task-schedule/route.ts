import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { getActorUserIdFromRequest } from '@/lib/getActorFromRequest';
import { notifyTaskScheduleChanged } from '@/src/server/notifications/notify';

export async function POST(request: Request) {
  try {
    const { taskId, scheduledDate, scheduledTime } = await request.json();

    if (!taskId) {
      return NextResponse.json({ error: 'Task ID is required' }, { status: 400 });
    }

    const { data: existing } = await getSupabaseServer()
      .from('turnover_tasks')
      .select('scheduled_date, scheduled_time')
      .eq('id', taskId)
      .maybeSingle();

    const { data, error } = await getSupabaseServer()
      .from('turnover_tasks')
      .update({ 
        scheduled_date: scheduledDate ?? null,
        scheduled_time: scheduledTime ?? null,
        updated_at: new Date().toISOString()
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
      await notifyTaskScheduleChanged({
        taskId,
        before: {
          scheduled_date: existing.scheduled_date ?? null,
          scheduled_time: existing.scheduled_time ?? null,
        },
        after: {
          scheduled_date: data.scheduled_date ?? null,
          scheduled_time: data.scheduled_time ?? null,
        },
        actor: { user_id: getActorUserIdFromRequest(request) },
      });
    }

    return NextResponse.json({ success: true, data }, { status: 200 });
  } catch (error: any) {
    console.error('API error:', error);
    return NextResponse.json({ error: error.message || 'An unexpected error occurred' }, { status: 500 });
  }
}
