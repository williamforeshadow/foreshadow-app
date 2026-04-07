import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

// GET - Fetch all tasks assigned to a specific user
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required' },
        { status: 400 }
      );
    }

    // Fetch task assignments for this user
    const { data: taskAssignments, error: tasksError } = await getSupabaseServer()
      .from('task_assignments')
      .select('task_id, assigned_at')
      .eq('user_id', userId);

    if (tasksError) {
      console.error('Error fetching task assignments:', tasksError);
      return NextResponse.json(
        { error: tasksError.message },
        { status: 500 }
      );
    }

    // Fetch the actual tasks with their templates
    const taskIds = taskAssignments?.map((ta: any) => ta.task_id) || [];
    let tasks: any[] = [];
    
    if (taskIds.length > 0) {
      const { data: taskData, error: taskDataError } = await getSupabaseServer()
        .from('turnover_tasks')
        .select(`
          id,
          reservation_id,
          template_id,
          title,
          description,
          priority,
          bin_id,
          property_name,
          type,
          department_id,
          scheduled_date,
          scheduled_time,
          status,
          form_metadata,
          templates(id, name, type, department_id),
          departments(id, name)
        `)
        .in('id', taskIds);

      if (taskDataError) {
        console.error('Error fetching tasks:', taskDataError);
        return NextResponse.json(
          { error: taskDataError.message },
          { status: 500 }
        );
      }

      const reservationIds = taskData
        ?.map((t: any) => t.reservation_id)
        .filter(Boolean) as string[];

      // Fetch reservation info
      let reservationsMap: { [key: string]: any } = {};
      if (reservationIds.length > 0) {
        const { data: reservations, error: reservationsError } = await getSupabaseServer()
          .from('reservations')
          .select('id, property_name, guest_name, check_in, check_out')
          .in('id', reservationIds);

        if (!reservationsError && reservations) {
          reservationsMap = reservations.reduce((acc: any, r: any) => {
            acc[r.id] = r;
            return acc;
          }, {} as { [key: string]: any });
        }
      }

      // Create a map of assignments (current user's assigned_at)
      const assignmentMap = taskAssignments?.reduce((acc: any, ta: any) => {
        acc[ta.task_id] = ta;
        return acc;
      }, {} as { [key: string]: any }) || {};

      // Fetch ALL assignees for these tasks (not just current user)
      let allAssigneesMap: Record<string, { user_id: string; name: string; avatar: string | null }[]> = {};
      if (taskIds.length > 0) {
        const { data: allAssignments } = await getSupabaseServer()
          .from('task_assignments')
          .select('task_id, user_id, users(id, name, avatar)')
          .in('task_id', taskIds);

        if (allAssignments) {
          allAssignments.forEach((a: any) => {
            const u = a.users as any;
            if (!allAssigneesMap[a.task_id]) allAssigneesMap[a.task_id] = [];
            allAssigneesMap[a.task_id].push({
              user_id: a.user_id,
              name: u?.name || 'Unknown',
              avatar: u?.avatar || null,
            });
          });
        }
      }

      // Transform tasks
      tasks = taskData?.map((task: any) => {
        const template = task.templates as any;
        const department = task.departments as any;
        const reservation = task.reservation_id ? reservationsMap[task.reservation_id] : null;
        const assignment = assignmentMap[task.id];
        
        return {
          task_id: task.id,
          reservation_id: task.reservation_id,
          template_id: task.template_id,
          template_name: template?.name || 'Unnamed Task',
          type: task.type || template?.type || 'cleaning',
          department_id: task.department_id || template?.department_id || null,
          department_name: department?.name || null,
          description: task.description || null,
          bin_id: task.bin_id || null,
          scheduled_date: task.scheduled_date,
          scheduled_time: task.scheduled_time,
          status: task.status || 'not_started',
          form_metadata: task.form_metadata,
          assigned_at: assignment?.assigned_at,
          assigned_users: allAssigneesMap[task.id] || [],
          property_name: reservation?.property_name || task.property_name || null,
          check_out: reservation?.check_out,
          check_in: reservation?.check_in,
          guest_name: reservation?.guest_name
        };
      }) || [];
    }

    return NextResponse.json({
      tasks,
      projects: [],
      summary: {
        total_tasks: tasks.length,
        completed_tasks: tasks.filter((t: any) => t?.status === 'complete').length,
        total_projects: 0,
        completed_projects: 0,
      }
    });
  } catch (err: any) {
    console.error('API error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to fetch assignments' },
      { status: 500 }
    );
  }
}

