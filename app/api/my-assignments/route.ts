import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET - Fetch all tasks and projects assigned to a specific user
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
    const { data: taskAssignments, error: tasksError } = await supabase
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
    const taskIds = taskAssignments?.map(ta => ta.task_id) || [];
    let tasks: any[] = [];
    
    if (taskIds.length > 0) {
      const { data: taskData, error: taskDataError } = await supabase
        .from('turnover_tasks')
        .select(`
          id,
          reservation_id,
          template_id,
          type,
          scheduled_start,
          status,
          templates(id, name, type, description)
        `)
        .in('id', taskIds);

      if (taskDataError) {
        console.error('Error fetching tasks:', taskDataError);
        return NextResponse.json(
          { error: taskDataError.message },
          { status: 500 }
        );
      }

      // Get reservation IDs to fetch property info
      const reservationIds = taskData
        ?.map(t => t.reservation_id)
        .filter(Boolean) as string[];

      // Fetch reservation info
      let reservationsMap: { [key: string]: any } = {};
      if (reservationIds.length > 0) {
        const { data: reservations, error: reservationsError } = await supabase
          .from('reservations')
          .select('id, property_name, guest_name, check_in, check_out')
          .in('id', reservationIds);

        if (!reservationsError && reservations) {
          reservationsMap = reservations.reduce((acc, r) => {
            acc[r.id] = r;
            return acc;
          }, {} as { [key: string]: any });
        }
      }

      // Create a map of assignments
      const assignmentMap = taskAssignments?.reduce((acc, ta) => {
        acc[ta.task_id] = ta;
        return acc;
      }, {} as { [key: string]: any }) || {};

      // Transform tasks
      tasks = taskData?.map(task => {
        const template = task.templates as any;
        const reservation = task.reservation_id ? reservationsMap[task.reservation_id] : null;
        const assignment = assignmentMap[task.id];
        
        return {
          task_id: task.id,
          reservation_id: task.reservation_id,
          template_id: task.template_id,
          template_name: template?.name || 'Unnamed Task',
          type: task.type || template?.type || 'cleaning',
          description: template?.description,
          scheduled_start: task.scheduled_start,
          status: task.status || 'not_started',
          assigned_at: assignment?.assigned_at,
          // Reservation context
          property_name: reservation?.property_name || 'Unknown Property',
          check_out: reservation?.check_out,
          check_in: reservation?.check_in,
          guest_name: reservation?.guest_name
        };
      }) || [];
    }

    // Fetch projects assigned to this user
    const { data: projectAssignments, error: projectsError } = await supabase
      .from('project_assignments')
      .select(`
        project_id,
        assigned_at,
        property_projects(
          id,
          property_name,
          title,
          description,
          status,
          priority,
          due_date,
          created_at
        )
      `)
      .eq('user_id', userId);

    if (projectsError) {
      console.error('Error fetching project assignments:', projectsError);
      return NextResponse.json(
        { error: projectsError.message },
        { status: 500 }
      );
    }

    // Transform projects
    const projects = projectAssignments?.map(pa => {
      const project = pa.property_projects as any;
      if (!project) return null;
      
      return {
        ...project,
        assigned_at: pa.assigned_at
      };
    }).filter(Boolean) || [];

    return NextResponse.json({
      tasks,
      projects,
      summary: {
        total_tasks: tasks.length,
        completed_tasks: tasks.filter((t: any) => t?.status === 'complete').length,
        total_projects: projects.length,
        completed_projects: projects.filter((p: any) => p?.status === 'complete').length
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

