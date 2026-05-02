import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

// GET /api/reservations/[id]/with-window-tasks
//
// Hydrates everything <ReservationDetailPanel> needs in a single round-trip:
//   - the reservation row (id, guest_name, check_in, check_out,
//     next_check_in, property_id, property_name)
//   - the property's tasks scheduled within the turnover window
//     [check_in, next_check_in] (open-ended fallback when next_check_in is
//     null — the panel's window-bounding logic handles the upper edge).
//
// This is the entry point used by the global Reservation Viewer (key-icon
// click from any task row in the app). Existing inline panel hosts
// (PropertyScheduleView, TurnoversWindow) still source their own data via
// /api/properties/[id]/schedule — this endpoint exists so callers who only
// have a reservation_id can render the panel without first locating the
// property.
//
// Response shape mirrors the field names ScheduleReservation and
// ScheduleTask consume so the panel takes it as-is.

const FALLBACK_WINDOW_DAYS = 60;

function addDaysISO(dateOnly: string, days: number): string {
  const d = new Date(`${dateOnly}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const supabase = getSupabaseServer();

  const { data: reservation, error: resError } = await supabase
    .from('reservations')
    .select(
      'id, guest_name, check_in, check_out, next_check_in, property_id, property_name'
    )
    .eq('id', id)
    .maybeSingle();

  if (resError) {
    return NextResponse.json({ error: resError.message }, { status: 500 });
  }
  if (!reservation) {
    return NextResponse.json(
      { error: 'reservation not found' },
      { status: 404 }
    );
  }

  const start = (reservation.check_in || '').slice(0, 10);
  const end = reservation.next_check_in
    ? reservation.next_check_in.slice(0, 10)
    : addDaysISO(start, FALLBACK_WINDOW_DAYS);

  // Reservations always carry a property_id. If a row somehow lacks one,
  // surface a 500 rather than silently returning an empty list — that's a
  // data integrity violation (the row shouldn't exist).
  if (!reservation.property_id) {
    return NextResponse.json(
      {
        error: `Reservation ${reservation.id} has no property_id; data integrity violation.`,
      },
      { status: 500 }
    );
  }

  // Pull the canonical property name for the response. property_id alone is
  // enough to scope the tasks query below; we just need the name for display.
  const { data: propertyRow } = await supabase
    .from('properties')
    .select('name')
    .eq('id', reservation.property_id)
    .maybeSingle();
  const resolvedPropertyName: string | null =
    propertyRow?.name || reservation.property_name || null;

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
      project_bins(id, name, is_system),
      task_assignments(user_id, users(id, name, email, role, avatar))
      `
    )
    .eq('property_id', reservation.property_id)
    .not('scheduled_date', 'is', null)
    .gte('scheduled_date', start)
    .lte('scheduled_date', end)
    .order('scheduled_date', { ascending: true });

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
      property_id: task.property_id || reservation.property_id,
      property_name: task.property_name || resolvedPropertyName,
      template_id: task.template_id,
      template_name: template?.name || null,
      title: task.title || null,
      description: task.description || null,
      priority: task.priority || 'medium',
      department_id:
        task.department_id || template?.department_id || null,
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
      is_automated: task.template_id != null,
      assigned_users: assignments.map((a) => ({
        user_id: a.user_id,
        name: a.users?.name || '',
        avatar: a.users?.avatar || null,
        role: a.users?.role || '',
      })),
    };
  });

  return NextResponse.json({
    reservation: {
      id: reservation.id,
      guest_name: reservation.guest_name,
      check_in: start,
      check_out: (reservation.check_out || '').slice(0, 10),
      next_check_in: reservation.next_check_in
        ? reservation.next_check_in.slice(0, 10)
        : null,
      property_id: reservation.property_id,
      property_name: resolvedPropertyName,
    },
    tasks: transformedTasks,
    window: { start, end },
  });
}
