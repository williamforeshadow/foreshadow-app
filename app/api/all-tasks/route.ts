import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

// GET - Fetch all tasks with related data
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const type = searchParams.get('type');
    const propertyName = searchParams.get('property_name');

    // Fetch tasks with related data
    let query = getSupabaseServer()
      .from('turnover_tasks')
      .select(`
        id,
        reservation_id,
        template_id,
        type,
        status,
        scheduled_start,
        form_metadata,
        completed_at,
        created_at,
        updated_at,
        templates(id, name, type),
        reservations(id, property_name, guest_name, check_in, check_out),
        task_assignments(user_id, users(id, name, avatar, role))
      `)
      .order('created_at', { ascending: false });

    // Apply optional filters
    if (status) {
      query = query.eq('status', status);
    }
    if (type) {
      query = query.eq('type', type);
    }

    const { data: tasks, error } = await query;

    if (error) {
      console.error('Error fetching tasks:', error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    // Fetch all reservations to compute next_check_in for each task
    // We need property_name and check_in to find the next reservation
    const { data: allReservations, error: reservationsError } = await getSupabaseServer()
      .from('reservations')
      .select('id, property_name, check_in, check_out')
      .order('check_in', { ascending: true });

    if (reservationsError) {
      console.error('Error fetching reservations:', reservationsError);
      return NextResponse.json(
        { error: reservationsError.message },
        { status: 500 }
      );
    }

    // Group reservations by property for efficient lookup
    const reservationsByProperty: Record<string, Array<{ id: string; check_in: string; check_out: string }>> = {};
    allReservations?.forEach(r => {
      if (!reservationsByProperty[r.property_name]) {
        reservationsByProperty[r.property_name] = [];
      }
      reservationsByProperty[r.property_name].push({
        id: r.id,
        check_in: r.check_in,
        check_out: r.check_out
      });
    });

    // Helper to find next_check_in for a given reservation
    const findNextCheckIn = (propertyName: string, checkOut: string | null): string | null => {
      if (!checkOut || !reservationsByProperty[propertyName]) return null;
      
      const checkOutDate = new Date(checkOut);
      const propertyReservations = reservationsByProperty[propertyName];
      
      // Find the first reservation where check_in is after this reservation's check_out
      for (const res of propertyReservations) {
        const resCheckIn = new Date(res.check_in);
        if (resCheckIn > checkOutDate) {
          return res.check_in;
        }
      }
      return null;
    };

    // Transform the data to flatten nested structures
    const transformedTasks = tasks?.map(task => {
      const template = task.templates as any;
      const reservation = task.reservations as any;
      const assignments = (task.task_assignments || []) as any[];

      const propertyName = reservation?.property_name || 'Unknown Property';
      const checkOut = reservation?.check_out || null;
      const nextCheckIn = findNextCheckIn(propertyName, checkOut);

      return {
        task_id: task.id,
        reservation_id: task.reservation_id,
        template_id: task.template_id,
        template_name: template?.name || 'Unnamed Task',
        type: task.type || template?.type || 'cleaning',
        status: task.status || 'not_started',
        scheduled_start: task.scheduled_start,
        form_metadata: task.form_metadata,
        completed_at: task.completed_at,
        created_at: task.created_at,
        updated_at: task.updated_at,
        // Reservation context
        property_name: propertyName,
        guest_name: reservation?.guest_name,
        check_in: reservation?.check_in,
        check_out: checkOut,
        next_check_in: nextCheckIn,
        // Assigned users
        assigned_users: assignments.map(a => ({
          user_id: a.user_id,
          name: a.users?.name || '',
          avatar: a.users?.avatar || '',
          role: a.users?.role || ''
        }))
      };
    }) || [];

    // Filter by property name if provided (post-query since it's in a join)
    let filteredTasks = transformedTasks;
    if (propertyName) {
      filteredTasks = transformedTasks.filter(t => 
        t.property_name.toLowerCase().includes(propertyName.toLowerCase())
      );
    }

    // Calculate summary stats
    const summary = {
      total: filteredTasks.length,
      not_started: filteredTasks.filter(t => t.status === 'not_started').length,
      in_progress: filteredTasks.filter(t => t.status === 'in_progress').length,
      complete: filteredTasks.filter(t => t.status === 'complete').length,
      by_type: {
        cleaning: filteredTasks.filter(t => t.type === 'cleaning').length,
        maintenance: filteredTasks.filter(t => t.type === 'maintenance').length
      }
    };

    return NextResponse.json({
      success: true,
      data: filteredTasks,
      summary
    });
  } catch (err: any) {
    console.error('API error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to fetch tasks' },
      { status: 500 }
    );
  }
}

