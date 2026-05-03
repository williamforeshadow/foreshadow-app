import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

// GET /api/all-tasks/[id]
//
// Single-task lookup, shaped like a row from GET /api/all-tasks. Used by
// ReservationViewerProvider's deep-link handler to resolve a `?task=<uuid>`
// query param into the OverlayTaskInput the global task overlay expects.
//
// We deliberately don't go through /api/all-tasks?id=... because it does an
// in-memory scan over the entire ledger; this endpoint indexes by primary
// key, returns 404 cleanly when the id is bogus or the row was deleted, and
// keeps the client deep-link path snappy.
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: 'Task id is required' }, { status: 400 });
  }

  const { data: task, error } = await getSupabaseServer()
    .from('turnover_tasks')
    .select(
      `
      id,
      reservation_id,
      property_id,
      property_name,
      template_id,
      title,
      description,
      priority,
      department_id,
      status,
      scheduled_date,
      scheduled_time,
      bin_id,
      is_binned,
      form_metadata,
      completed_at,
      created_at,
      updated_at,
      templates(id, name, department_id),
      departments(id, name),
      project_bins(id, name, is_system),
      reservations(id, property_name, guest_name, check_in, check_out),
      task_assignments(user_id, users(id, name, avatar, role)),
      project_comments(count)
    `,
    )
    .eq('id', id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  const t = task as any;
  const template = t.templates as any;
  const reservation = t.reservations as any;
  const department = t.departments as any;
  const bin = t.project_bins as any;
  const assignments = (t.task_assignments || []) as any[];
  const commentAgg = t.project_comments as any;
  const commentCount = Array.isArray(commentAgg)
    ? Number(commentAgg[0]?.count ?? 0)
    : 0;

  const data = {
    task_id: t.id,
    reservation_id: t.reservation_id,
    property_id: t.property_id || null,
    template_id: t.template_id,
    template_name: template?.name || 'Unnamed Task',
    title: t.title || null,
    description: t.description || null,
    priority: t.priority || 'medium',
    department_id: t.department_id || template?.department_id || null,
    department_name: department?.name || null,
    status: t.status || 'not_started',
    scheduled_date: t.scheduled_date,
    scheduled_time: t.scheduled_time,
    form_metadata: t.form_metadata,
    completed_at: t.completed_at,
    created_at: t.created_at,
    updated_at: t.updated_at,
    bin_id: t.bin_id || null,
    bin_name: bin?.name || null,
    bin_is_system: !!bin?.is_system,
    is_binned: t.is_binned ?? false,
    is_automated: t.template_id != null,
    property_name:
      t.property_name || reservation?.property_name || 'Unknown Property',
    guest_name: reservation?.guest_name || null,
    check_in: reservation?.check_in || null,
    check_out: reservation?.check_out || null,
    is_recurring: t.reservation_id === null,
    assigned_users: assignments.map((a) => ({
      user_id: a.user_id,
      name: a.users?.name || '',
      avatar: a.users?.avatar || null,
      role: a.users?.role || '',
    })),
    comment_count: commentCount,
  };

  return NextResponse.json({ success: true, data });
}
