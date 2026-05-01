import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

// GET /api/all-tasks
//
// Global task ledger — returns every row in `turnover_tasks` plus the metadata
// needed by the shared <TaskRow /> component (status / priority / department /
// assignees / bin / comment count / origin). The Tasks tab on the dashboard
// reads from here; client-side filtering / sorting / grouping are then layered
// on top in `lib/useTasks.ts`.
//
// Response shape mirrors `/api/properties/[id]/tasks` so the same UI pieces
// work in both places. The reservation-window fields (`check_in`, `check_out`,
// `guest_name`) are kept for the detail panel but are no longer used by the
// list row itself.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const propertyName = searchParams.get('property_name');

    let query = getSupabaseServer()
      .from('turnover_tasks')
      .select(`
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
      `)
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);

    const { data: tasks, error } = await query;

    if (error) {
      console.error('Error fetching tasks:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const transformedTasks = (tasks || []).map((task: any) => {
      const template = task.templates as any;
      const reservation = task.reservations as any;
      const department = task.departments as any;
      const bin = task.project_bins as any;
      const assignments = (task.task_assignments || []) as any[];
      const commentAgg = task.project_comments as any;
      const commentCount = Array.isArray(commentAgg)
        ? Number(commentAgg[0]?.count ?? 0)
        : 0;

      const propName =
        task.property_name || reservation?.property_name || 'Unknown Property';

      return {
        task_id: task.id,
        reservation_id: task.reservation_id,
        property_id: task.property_id || null,
        template_id: task.template_id,
        template_name: template?.name || 'Unnamed Task',
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
        bin_is_system: !!bin?.is_system,
        is_binned: task.is_binned ?? false,
        // Automation-generated tasks (reservation turnovers, recurring rules,
        // templated spawns) always carry a template_id; manually-created
        // tasks (New Task button → /api/tasks-for-bin POST) leave it null.
        // Mirrors the rule used by /api/properties/[id]/tasks.
        is_automated: task.template_id != null,
        property_name: propName,
        guest_name: reservation?.guest_name || null,
        check_in: reservation?.check_in || null,
        check_out: reservation?.check_out || null,
        is_recurring: task.reservation_id === null,
        assigned_users: assignments.map((a) => ({
          user_id: a.user_id,
          name: a.users?.name || '',
          avatar: a.users?.avatar || '',
          role: a.users?.role || '',
        })),
        comment_count: commentCount,
      };
    });

    let filteredTasks = transformedTasks;
    if (propertyName) {
      filteredTasks = transformedTasks.filter((t: any) =>
        t.property_name.toLowerCase().includes(propertyName.toLowerCase())
      );
    }

    const byDepartment: Record<string, number> = {};
    filteredTasks.forEach((t: any) => {
      const deptName = t.department_name || 'unknown';
      byDepartment[deptName] = (byDepartment[deptName] || 0) + 1;
    });

    const summary = {
      total: filteredTasks.length,
      not_started: filteredTasks.filter((t: any) => t.status === 'not_started').length,
      in_progress: filteredTasks.filter((t: any) => t.status === 'in_progress').length,
      complete: filteredTasks.filter((t: any) => t.status === 'complete').length,
      by_department: byDepartment,
    };

    return NextResponse.json({
      success: true,
      data: filteredTasks,
      summary,
    });
  } catch (err: any) {
    console.error('API error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to fetch tasks' },
      { status: 500 }
    );
  }
}
