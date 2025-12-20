import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// POST - Update task assignments (replaces all existing assignments)
export async function POST(request: Request) {
  try {
    const { taskId, userIds } = await request.json();

    if (!taskId) {
      return NextResponse.json({ error: 'Task ID is required' }, { status: 400 });
    }

    // Ensure userIds is an array
    const assigneeIds: string[] = Array.isArray(userIds) ? userIds : (userIds ? [userIds] : []);

    // Delete existing assignments for this task
    const { error: deleteError } = await supabase
      .from('task_assignments')
      .delete()
      .eq('task_id', taskId);

    if (deleteError) {
      console.error('Error deleting existing assignments:', deleteError);
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    // Insert new assignments if any
    if (assigneeIds.length > 0) {
      const assignments = assigneeIds.map(userId => ({
        task_id: taskId,
        user_id: userId
      }));

      const { error: insertError } = await supabase
        .from('task_assignments')
        .insert(assignments);

      if (insertError) {
        console.error('Error inserting assignments:', insertError);
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }
    }

    // Fetch the updated task with assignments
    const { data: task, error: fetchError } = await supabase
      .from('turnover_tasks')
      .select(`
        *,
        task_assignments(
          user_id,
          users(id, name, email, role, avatar)
        )
      `)
      .eq('id', taskId)
      .single();

    if (fetchError) {
      console.error('Error fetching updated task:', fetchError);
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: task }, { status: 200 });
  } catch (error: any) {
    console.error('API error:', error);
    return NextResponse.json({ error: error.message || 'An unexpected error occurred' }, { status: 500 });
  }
}

// GET - Get assignments for a specific task
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get('task_id');

    if (!taskId) {
      return NextResponse.json({ error: 'task_id is required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('task_assignments')
      .select(`
        user_id,
        assigned_at,
        users(id, name, email, role, avatar)
      `)
      .eq('task_id', taskId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
