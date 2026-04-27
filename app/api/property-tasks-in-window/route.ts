import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

// GET /api/property-tasks-in-window?property_name=X&start=YYYY-MM-DD&end=YYYY-MM-DD
//
// Returns the flat list of turnover_tasks scheduled within [start, end]
// (inclusive) for a single property. Used by the Turnovers panel to hydrate
// "associated tasks" for a reservation's turnover window — defined as
// [reservation.check_in, reservation.next_check_in). When next_check_in is
// null the caller passes a far-future end (open-ended display).
//
// The response shape matches the `tasks` array returned by
// /api/properties/[id]/schedule so ReservationDetailPanel + the shared
// PropertyTaskDetailOverlay can consume it without a translation layer.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const propertyName = searchParams.get('property_name');
  const start = searchParams.get('start');
  const end = searchParams.get('end');

  if (!propertyName) {
    return NextResponse.json(
      { error: 'property_name is required' },
      { status: 400 }
    );
  }
  if (!start || !end) {
    return NextResponse.json(
      { error: 'start and end (YYYY-MM-DD) are required' },
      { status: 400 }
    );
  }

  const supabase = getSupabaseServer();

  // Resolve property_id when possible so the dual-write OR filter works for
  // both legacy (name-only) and canonical (id) rows. Missing property is not
  // a hard error — fall back to property_name-only filtering.
  const { data: property } = await supabase
    .from('properties')
    .select('id, name')
    .eq('name', propertyName)
    .maybeSingle();

  let query = supabase
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
      type,
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
      templates(id, name, type, department_id),
      departments(id, name),
      project_bins(id, name, is_system),
      task_assignments(user_id, users(id, name, email, role, avatar))
    `
    )
    .not('scheduled_date', 'is', null)
    .gte('scheduled_date', start)
    .lte('scheduled_date', end)
    .order('scheduled_date', { ascending: true });

  if (property?.id) {
    query = query.or(
      `property_id.eq.${property.id},property_name.eq.${propertyName}`
    );
  } else {
    query = query.eq('property_name', propertyName);
  }

  const { data: tasks, error: tasksError } = await query;
  if (tasksError) {
    return NextResponse.json({ error: tasksError.message }, { status: 500 });
  }

  const transformedTasks = (tasks || []).map((task: any) => {
    const template = task.templates as any;
    const department = task.departments as any;
    const bin = task.project_bins as any;
    const assignments = (task.task_assignments || []) as any[];
    return {
      task_id: task.id,
      reservation_id: task.reservation_id,
      property_id: task.property_id || property?.id || null,
      property_name: task.property_name || propertyName,
      template_id: task.template_id,
      template_name: template?.name || null,
      title: task.title || null,
      description: task.description || null,
      priority: task.priority || 'medium',
      type: task.type || template?.type || 'cleaning',
      department_id: task.department_id || template?.department_id || null,
      department_name: department?.name || null,
      status: task.status || 'not_started',
      scheduled_date: task.scheduled_date,
      scheduled_time: task.scheduled_time,
      form_metadata: task.form_metadata,
      completed_at: task.completed_at,
      created_at: task.created_at,
      updated_at: task.updated_at,
      bin_id: task.bin_id || null,
      bin_name: bin?.name || null,
      is_binned: !!task.is_binned,
      is_automated: (task.type || '') !== 'project',
      assigned_users: assignments.map((a) => ({
        user_id: a.user_id,
        name: a.users?.name || '',
        avatar: a.users?.avatar || null,
        role: a.users?.role || '',
      })),
    };
  });

  return NextResponse.json({
    property: property
      ? { id: property.id, name: property.name }
      : { id: null, name: propertyName },
    window: { start, end },
    tasks: transformedTasks,
  });
}
