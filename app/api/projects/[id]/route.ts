import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { logProjectActivity } from '@/lib/logProjectActivity';

// GET - Get a single project with assignments
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const { data, error } = await getSupabaseServer()
      .from('property_projects')
      .select(`
        *,
        project_assignments(
          user_id,
          assigned_at,
          users(id, name, email, role, avatar)
        )
      `)
      .eq('id', id)
      .single();

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to fetch project' },
      { status: 500 }
    );
  }
}

// PUT - Update a project and its assignments
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { title, description, status, priority, assigned_user_ids, due_date, user_id } = body;

    // Fetch current project to compare for activity logging
    const { data: oldProject } = await getSupabaseServer()
      .from('property_projects')
      .select(`
        *,
        project_assignments(user_id, users(id, name))
      `)
      .eq('id', id)
      .single();

    // Update project fields
    const updateData: any = { updated_at: new Date().toISOString() };
    
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (status !== undefined) updateData.status = status;
    if (priority !== undefined) updateData.priority = priority;
    if (due_date !== undefined) updateData.due_date = due_date;

    const { error: updateError } = await getSupabaseServer()
      .from('property_projects')
      .update(updateData)
      .eq('id', id);

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message },
        { status: 500 }
      );
    }

    // Update assignments if provided
    if (assigned_user_ids !== undefined) {
      const userIds: string[] = Array.isArray(assigned_user_ids) ? assigned_user_ids : (assigned_user_ids ? [assigned_user_ids] : []);

      // Delete existing assignments
      const { error: deleteError } = await getSupabaseServer()
        .from('project_assignments')
        .delete()
        .eq('project_id', id);

      if (deleteError) {
        console.error('Error deleting assignments:', deleteError);
      }

      // Insert new assignments
      if (userIds.length > 0) {
        const assignments = userIds.map(userId => ({
          project_id: id,
          user_id: userId
        }));

        const { error: insertError } = await getSupabaseServer()
          .from('project_assignments')
          .insert(assignments);

        if (insertError) {
          console.error('Error inserting assignments:', insertError);
        }
      }
    }

    // Fetch updated project with assignments
    const { data, error: fetchError } = await getSupabaseServer()
      .from('property_projects')
      .select(`
        *,
        project_assignments(
          user_id,
          assigned_at,
          users(id, name, email, role, avatar)
        )
      `)
      .eq('id', id)
      .single();

    if (fetchError) {
      return NextResponse.json(
        { error: fetchError.message },
        { status: 500 }
      );
    }

    // Log activity for changes (if user_id provided)
    if (user_id && oldProject) {
      const statusLabels: Record<string, string> = {
        'not_started': 'Not Started',
        'in_progress': 'In Progress',
        'on_hold': 'On Hold',
        'complete': 'Complete'
      };
      const priorityLabels: Record<string, string> = {
        'low': 'Low',
        'medium': 'Medium',
        'high': 'High',
        'urgent': 'Urgent'
      };

      // Title change
      if (title !== undefined && title !== oldProject.title) {
        await logProjectActivity(id, user_id, 'title_change', `changed title to "${title}"`, oldProject.title, title);
      }
      // Status change
      if (status !== undefined && status !== oldProject.status) {
        await logProjectActivity(id, user_id, 'status_change', `changed status from "${statusLabels[oldProject.status] || oldProject.status}" to "${statusLabels[status] || status}"`, oldProject.status, status);
      }
      // Priority change
      if (priority !== undefined && priority !== oldProject.priority) {
        await logProjectActivity(id, user_id, 'priority_change', `changed priority from "${priorityLabels[oldProject.priority] || oldProject.priority}" to "${priorityLabels[priority] || priority}"`, oldProject.priority, priority);
      }
      // Description change
      if (description !== undefined && description !== oldProject.description) {
        await logProjectActivity(id, user_id, 'description_change', 'updated the description', oldProject.description, description);
      }
      // Due date change
      if (due_date !== undefined && due_date !== oldProject.due_date) {
        const formattedDate = due_date ? new Date(due_date).toLocaleDateString() : 'none';
        await logProjectActivity(id, user_id, 'due_date_change', `changed due date to "${formattedDate}"`, oldProject.due_date, due_date);
      }
      // Assignment change
      if (assigned_user_ids !== undefined) {
        const oldAssigneeId = oldProject.project_assignments?.[0]?.user_id;
        const newAssigneeId = Array.isArray(assigned_user_ids) ? assigned_user_ids[0] : assigned_user_ids;
        if (oldAssigneeId !== newAssigneeId) {
          const newAssigneeName = data?.project_assignments?.[0]?.users?.name || 'someone';
          if (newAssigneeId) {
            await logProjectActivity(id, user_id, 'assignment_change', `assigned ${newAssigneeName} to the project`, oldAssigneeId, newAssigneeId);
          } else {
            await logProjectActivity(id, user_id, 'assignment_change', 'removed assignment from the project', oldAssigneeId, null);
          }
        }
      }
    }

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to update project' },
      { status: 500 }
    );
  }
}

// DELETE - Delete a project (assignments cascade automatically)
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const { error } = await getSupabaseServer()
      .from('property_projects')
      .delete()
      .eq('id', id);

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, message: 'Project deleted' });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to delete project' },
      { status: 500 }
    );
  }
}
