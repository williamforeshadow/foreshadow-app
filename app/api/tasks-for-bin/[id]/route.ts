import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const {
      title,
      description,
      status,
      priority,
      assigned_user_ids,
      scheduled_date,
      scheduled_time,
      department_id,
      property_name,
      property_id,
      bin_id,
      is_binned,
      template_id,
    } = body;

    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (status !== undefined) updateData.status = status;
    if (priority !== undefined) updateData.priority = priority;
    if (scheduled_date !== undefined) updateData.scheduled_date = scheduled_date;
    if (scheduled_time !== undefined) updateData.scheduled_time = scheduled_time;
    if (department_id !== undefined) updateData.department_id = department_id || null;
    if (property_name !== undefined) updateData.property_name = property_name || null;
    if (property_id !== undefined) updateData.property_id = property_id || null;
    if (bin_id !== undefined) updateData.bin_id = bin_id || null;
    if (is_binned !== undefined) updateData.is_binned = is_binned;
    if (template_id !== undefined) updateData.template_id = template_id || null;

    // Hard-block property/template reassignment on existing tasks.
    // Either side of the (property_name, property_id) pair is blocked.
    if (
      property_name !== undefined ||
      property_id !== undefined ||
      template_id !== undefined
    ) {
      const { data: existing } = await getSupabaseServer()
        .from('turnover_tasks')
        .select('property_name, property_id, template_id')
        .eq('id', id)
        .single();

      if (existing) {
        if (property_name !== undefined || property_id !== undefined) {
          return NextResponse.json({ error: 'Property cannot be changed after task creation' }, { status: 400 });
        }
        if (template_id !== undefined) {
          return NextResponse.json({ error: 'Template cannot be changed after task creation' }, { status: 400 });
        }
      }
    }

    const { error: updateError } = await getSupabaseServer()
      .from('turnover_tasks')
      .update(updateData)
      .eq('id', id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    if (assigned_user_ids !== undefined) {
      const userIds: string[] = Array.isArray(assigned_user_ids)
        ? assigned_user_ids
        : assigned_user_ids
        ? [assigned_user_ids]
        : [];

      await getSupabaseServer()
        .from('task_assignments')
        .delete()
        .eq('task_id', id);

      if (userIds.length > 0) {
        const assignments = userIds.map((userId) => ({
          task_id: id,
          user_id: userId,
        }));

        await getSupabaseServer().from('task_assignments').insert(assignments);
      }
    }

    const { data, error: fetchError } = await getSupabaseServer()
      .from('turnover_tasks')
      .select(`
        id,
        property_name,
        property_id,
        template_id,
        title,
        description,
        priority,
        bin_id,
        is_binned,
        type,
        department_id,
        status,
        scheduled_date,
        scheduled_time,
        form_metadata,
        created_at,
        updated_at,
        completed_at,
        templates(id, name),
        departments(id, name),
        task_assignments(
          user_id,
          assigned_at,
          users(id, name, email, role, avatar)
        )
      `)
      .eq('id', id)
      .single();

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    const tmpl = data.templates as any;
    const transformed = {
      id: data.id,
      property_name: data.property_name || null,
      property_id: (data as any).property_id || null,
      bin_id: data.bin_id || null,
      is_binned: data.is_binned ?? false,
      template_id: data.template_id || null,
      template_name: tmpl?.name || null,
      title: data.title || 'Untitled Task',
      description: data.description || null,
      status: data.status || 'not_started',
      priority: data.priority || 'medium',
      department_id: data.department_id || null,
      department_name: (data.departments as any)?.name || null,
      scheduled_date: data.scheduled_date || null,
      scheduled_time: data.scheduled_time || null,
      form_metadata: data.form_metadata || null,
      created_at: data.created_at,
      updated_at: data.updated_at,
      completed_at: (data as any).completed_at || null,
      project_assignments: (data.task_assignments as any[])?.map((a: any) => ({
        ...a,
        user: a.users || null,
      })) || [],
    };

    return NextResponse.json({ success: true, data: transformed });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to update task' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const { error } = await getSupabaseServer()
      .from('turnover_tasks')
      .delete()
      .eq('id', id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Task deleted' });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to delete task' },
      { status: 500 }
    );
  }
}
