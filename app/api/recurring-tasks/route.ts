import { NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/requireAuthContext';

// GET /api/recurring-tasks
//
// Replaces the direct browser anon-client read of `turnover_tasks` (recurring
// tasks — reservation_id IS NULL) in lib/useTimeline.ts. Routed through the
// user-scoped client so RLS governs the result once armed. Same select shape as
// before so the timeline's transform is unchanged; returned under `data`.
export async function GET() {
  const ctx = await requireAuthContext();
  if (ctx instanceof NextResponse) return ctx;

  const { data, error } = await ctx.supabase
    .from('turnover_tasks')
    .select(`
      id,
      property_name,
      template_id,
      title,
      description,
      priority,
      bin_id,
      is_binned,
      department_id,
      status,
      scheduled_date,
      scheduled_time,
      form_metadata,
      completed_at,
      created_at,
      updated_at,
      templates(id, name, department_id),
      departments(id, name),
      task_assignments(user_id, users(id, name, avatar, role))
    `)
    .is('reservation_id', null)
    .order('scheduled_date', { ascending: true, nullsFirst: false });

  if (error) {
    console.error('[GET /api/recurring-tasks] error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data: data ?? [] });
}
