import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

// GET /api/properties/[id]/schedule?year=YYYY&month=MM
//
// Returns everything the per-property Schedule calendar needs for the given
// calendar month: reservations whose [check_in, check_out] window overlaps
// the month, plus turnover_tasks scheduled during the month. Both are scoped
// to this property by property_id.
//
// We actually widen the window by ±7 days so events that spill into the
// adjacent-month rows of a 6-week grid are visible without a second fetch.
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: propertyId } = await context.params;
  if (!propertyId) {
    return NextResponse.json({ error: 'Property id is required' }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const yearParam = Number(searchParams.get('year'));
  const monthParam = Number(searchParams.get('month')); // 1-indexed: 1 = Jan
  const now = new Date();
  const year =
    Number.isFinite(yearParam) && yearParam > 1970 ? yearParam : now.getFullYear();
  const month =
    Number.isFinite(monthParam) && monthParam >= 1 && monthParam <= 12
      ? monthParam
      : now.getMonth() + 1;

  const supabase = getSupabaseServer();

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

  // Compute month window plus a 7-day buffer on each side (to cover the
  // surrounding rows of a 6-week grid). All comparisons are on the date
  // portion only; we format as YYYY-MM-DD strings so the SQL comparisons are
  // unambiguous regardless of timezone.
  const pad = (n: number) => String(n).padStart(2, '0');
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0)); // last day of month
  const bufferStart = new Date(monthStart);
  bufferStart.setUTCDate(bufferStart.getUTCDate() - 7);
  const bufferEnd = new Date(monthEnd);
  bufferEnd.setUTCDate(bufferEnd.getUTCDate() + 7);

  const toISO = (d: Date) =>
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

  const windowStart = toISO(bufferStart);
  const windowEnd = toISO(bufferEnd);

  // Reservations overlapping the window:
  //   check_in <= windowEnd  AND  check_out >= windowStart
  const { data: reservations, error: resError } = await supabase
    .from('reservations')
    .select(
      `
      id,
      property_id,
      property_name,
      guest_name,
      check_in,
      check_out,
      next_check_in,
      hostaway_reservation_id
    `
    )
    .eq('property_id', propertyId)
    .lte('check_in', windowEnd)
    .gte('check_out', windowStart)
    .order('check_in', { ascending: true });

  if (resError) {
    return NextResponse.json({ error: resError.message }, { status: 500 });
  }

  // Tasks scheduled in the window. Same property filter. We pull enough to
  // render a task pill + open the ProjectDetailPanel on click.
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
    .eq('property_id', propertyId)
    .not('scheduled_date', 'is', null)
    .gte('scheduled_date', windowStart)
    .lte('scheduled_date', windowEnd)
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
      property_id: task.property_id || null,
      property_name: task.property_name || property.name,
      template_id: task.template_id,
      template_name: template?.name || null,
      title: task.title || null,
      description: task.description || null,
      priority: task.priority || 'medium',
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
    property: { id: property.id, name: property.name },
    window: { start: windowStart, end: windowEnd, year, month },
    reservations: reservations || [],
    tasks: transformedTasks,
  });
}
