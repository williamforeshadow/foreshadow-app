import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const binId = searchParams.get('bin_id');
    const viewerUserId = searchParams.get('viewer_user_id');

    const selectFields = `
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
      `;

    let query;

    if (binId === '__all__') {
      // Return all manually-created tasks (no reservation) regardless of bin
      query = getSupabaseServer()
        .from('turnover_tasks')
        .select(selectFields)
        .is('reservation_id', null)
        .order('created_at', { ascending: false });
    } else if (binId) {
      query = getSupabaseServer()
        .from('turnover_tasks')
        .select(selectFields)
        .eq('bin_id', binId)
        .order('created_at', { ascending: false });
    } else {
      // Default: all binned tasks
      query = getSupabaseServer()
        .from('turnover_tasks')
        .select(selectFields)
        .eq('is_binned', true)
        .order('created_at', { ascending: false });
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    let unreadCounts: Record<string, number> = {};
    if (viewerUserId) {
      const { data: viewsData } = await getSupabaseServer()
        .from('project_views')
        .select('project_id, last_viewed_at')
        .eq('user_id', viewerUserId);

      const viewsMap: Record<string, string> = {};
      (viewsData || []).forEach((view: any) => {
        viewsMap[view.project_id] = view.last_viewed_at;
      });

      const taskIds = data?.map((t: any) => t.id) || [];
      if (taskIds.length > 0) {
        const { data: allComments } = await getSupabaseServer()
          .from('project_comments')
          .select('task_id, user_id, created_at')
          .in('task_id', taskIds);

        (allComments || []).forEach((comment: any) => {
          const lastViewed = viewsMap[comment.task_id];
          const isOwnComment = comment.user_id === viewerUserId;
          const isUnread = !isOwnComment && (!lastViewed || new Date(comment.created_at) > new Date(lastViewed));
          if (isUnread) {
            unreadCounts[comment.task_id] = (unreadCounts[comment.task_id] || 0) + 1;
          }
        });
      }
    }

    const transformed = data?.map((task: any) => {
      const template = task.templates as any;
      const department = task.departments as any;

      return {
        id: task.id,
        property_name: task.property_name || null,
        property_id: (task as any).property_id || null,
        bin_id: task.bin_id || null,
        is_binned: task.is_binned ?? false,
        template_id: task.template_id || null,
        template_name: template?.name || null,
        title: task.title || template?.name || 'Untitled Task',
        description: task.description || null,
        status: task.status || 'not_started',
        priority: task.priority || 'medium',
        department_id: task.department_id || null,
        department_name: department?.name || null,
        scheduled_date: task.scheduled_date || null,
        scheduled_time: task.scheduled_time || null,
        form_metadata: task.form_metadata || null,
        created_at: task.created_at,
        updated_at: task.updated_at,
        completed_at: task.completed_at || null,
        unread_comment_count: unreadCounts[task.id] || 0,
        project_assignments: task.task_assignments?.map((a: any) => ({
          ...a,
          user: a.users || null,
        })) || [],
      };
    }) || [];

    return NextResponse.json({ data: transformed });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to fetch tasks' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      property_name,
      property_id,
      title,
      description,
      status,
      priority,
      assigned_user_ids,
      scheduled_date,
      scheduled_time,
      department_id,
      bin_id,
      is_binned,
      template_id,
    } = body;

    if (!title) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }

    const supabase = getSupabaseServer();

    // Resolve (property_name, property_id) pair for dual-write.
    // Both can remain null for free-floating tasks. If only one side is given,
    // we try to resolve the other via the properties table; if resolution
    // fails we keep the provided value and leave the counterpart null (lax,
    // matches pre-migration behavior for orphan task scenarios).
    let resolvedPropertyName: string | null = property_name || null;
    let resolvedPropertyId: string | null = property_id || null;

    if (resolvedPropertyId && !resolvedPropertyName) {
      const { data: prop } = await supabase
        .from('properties')
        .select('name')
        .eq('id', resolvedPropertyId)
        .maybeSingle();
      if (prop) {
        resolvedPropertyName = prop.name;
      } else {
        resolvedPropertyId = null;
      }
    } else if (resolvedPropertyName && !resolvedPropertyId) {
      const { data: prop } = await supabase
        .from('properties')
        .select('id')
        .eq('name', resolvedPropertyName)
        .maybeSingle();
      if (prop) {
        resolvedPropertyId = prop.id;
      }
    }

    const { data: task, error } = await supabase
      .from('turnover_tasks')
      .insert({
        property_name: resolvedPropertyName,
        property_id: resolvedPropertyId,
        bin_id: bin_id || null,
        is_binned: is_binned ?? (bin_id ? true : false),
        title,
        description: description || null,
        status: status || 'not_started',
        priority: priority || 'medium',
        type: 'project',
        scheduled_date: scheduled_date || null,
        scheduled_time: scheduled_time || null,
        department_id: department_id || null,
        template_id: template_id || null,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const userIds: string[] = Array.isArray(assigned_user_ids)
      ? assigned_user_ids
      : assigned_user_ids
      ? [assigned_user_ids]
      : [];

    if (userIds.length > 0) {
      const assignments = userIds.map((userId) => ({
        task_id: task.id,
        user_id: userId,
      }));

      await getSupabaseServer().from('task_assignments').insert(assignments);
    }

    const { data: fullTask, error: fetchError } = await supabase
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
      .eq('id', task.id)
      .single();

    if (fetchError) {
      return NextResponse.json({ success: true, data: task });
    }

    const tmpl = fullTask.templates as any;
    const transformed = {
      id: fullTask.id,
      property_name: fullTask.property_name || null,
      property_id: (fullTask as any).property_id || null,
      bin_id: fullTask.bin_id || null,
      is_binned: fullTask.is_binned ?? false,
      template_id: fullTask.template_id || null,
      template_name: tmpl?.name || null,
      title: fullTask.title || 'Untitled Task',
      description: fullTask.description || null,
      status: fullTask.status || 'not_started',
      priority: fullTask.priority || 'medium',
      department_id: fullTask.department_id || null,
      department_name: (fullTask.departments as any)?.name || null,
      scheduled_date: fullTask.scheduled_date || null,
      scheduled_time: fullTask.scheduled_time || null,
      form_metadata: fullTask.form_metadata || null,
      created_at: fullTask.created_at,
      updated_at: fullTask.updated_at,
      completed_at: (fullTask as any).completed_at || null,
      unread_comment_count: 0,
      project_assignments: (fullTask.task_assignments as any[])?.map((a: any) => ({
        ...a,
        user: a.users || null,
      })) || [],
    };

    return NextResponse.json({ success: true, data: transformed });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to create task' },
      { status: 500 }
    );
  }
}
