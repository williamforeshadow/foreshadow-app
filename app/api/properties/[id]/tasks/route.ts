import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

// GET /api/properties/[id]/tasks
//
// Returns every task associated with this property — open, completed, binned,
// recurring, historical. The Property Tasks view is a ledger, so we do NOT
// curate. The client applies any filter/sort. Response shape is a superset
// of /api/my-assignments' transformed task shape plus bin metadata, priority,
// completed_at, created_at/updated_at, property_id, and is_recurring.
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: propertyId } = await context.params;
  if (!propertyId) {
    return NextResponse.json({ error: 'Property id is required' }, { status: 400 });
  }

  const supabase = getSupabaseServer();

  // Resolve property.name so we can fall back for any legacy rows where
  // property_id wasn't populated (migration is in-flight). We'll OR both
  // property_id and property_name into the filter below.
  const { data: property, error: propertyError } = await supabase
    .from('properties')
    .select('id, name')
    .eq('id', propertyId)
    .maybeSingle();

  if (propertyError) {
    return NextResponse.json({ error: propertyError.message }, { status: 500 });
  }
  if (!property) {
    return NextResponse.json({ error: 'Property not found' }, { status: 404 });
  }

  // Fetch everything for this property in one query. We include bins so the
  // row can render a bin name without a second round-trip, and task_assignments
  // so we can render assignee avatars.
  const { data: tasks, error: tasksError } = await supabase
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
      reservations(id, property_name, guest_name, check_in, check_out),
      task_assignments(user_id, users(id, name, email, role, avatar))
    `
    )
    .or(`property_id.eq.${propertyId},property_name.eq.${property.name}`);

  if (tasksError) {
    return NextResponse.json({ error: tasksError.message }, { status: 500 });
  }

  const transformed = (tasks || []).map((task: any) => {
    const template = task.templates as any;
    const department = task.departments as any;
    const reservation = task.reservations as any;
    const bin = task.project_bins as any;
    const assignments = (task.task_assignments || []) as any[];

    return {
      task_id: task.id,
      reservation_id: task.reservation_id,
      property_id: task.property_id || null,
      property_name: task.property_name || reservation?.property_name || property.name,
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
      bin_is_system: !!bin?.is_system,
      is_binned: task.is_binned ?? false,
      // Recurring / auto-generated tasks have no reservation attached. Tasks
      // spawned by reservation turnovers always have one.
      is_recurring: task.reservation_id == null,
      guest_name: reservation?.guest_name || null,
      check_in: reservation?.check_in || null,
      check_out: reservation?.check_out || null,
      assigned_users: assignments.map((a) => ({
        user_id: a.user_id,
        name: a.users?.name || '',
        avatar: a.users?.avatar || null,
        role: a.users?.role || '',
      })),
    };
  });

  return NextResponse.json({
    property: { id: property.id, name: property.name },
    tasks: transformed,
  });
}
