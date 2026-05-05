import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { createTask, type CreatedTask } from '@/src/server/tasks/createTask';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const binId = searchParams.get('bin_id');
    const viewerUserId = searchParams.get('viewer_user_id');

    const selectFields = `
        id,
        property_name,
        property_id,
        reservation_id,
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

    // bin_id sentinels:
    //   '__all__'    — every manually-created task (no reservation), regardless
    //                  of bin status. Used by the Timeline window's "all tasks"
    //                  view; not surfaced in the Bins picker.
    //   '__every__'  — every binned task across the Task Bin and every sub-bin.
    //                  Internal transport for the Task Bin's "Global" toggle
    //                  (see useTaskBinGlobalView); never surfaced as
    //                  user-facing copy.
    //   <uuid>       — a specific sub-bin.
    //   missing/null — Task Bin (orphan binned tasks: is_binned=true AND
    //                  bin_id IS NULL). The default destination for binned
    //                  tasks not assigned to a specific sub-bin.
    let query;

    if (binId === '__all__') {
      query = getSupabaseServer()
        .from('turnover_tasks')
        .select(selectFields)
        .is('reservation_id', null)
        .order('created_at', { ascending: false });
    } else if (binId === '__every__') {
      query = getSupabaseServer()
        .from('turnover_tasks')
        .select(selectFields)
        .eq('is_binned', true)
        .order('created_at', { ascending: false });
    } else if (binId) {
      query = getSupabaseServer()
        .from('turnover_tasks')
        .select(selectFields)
        .eq('bin_id', binId)
        .order('created_at', { ascending: false });
    } else {
      // Task Bin: orphan binned tasks only (binned but no specific sub-bin).
      query = getSupabaseServer()
        .from('turnover_tasks')
        .select(selectFields)
        .eq('is_binned', true)
        .is('bin_id', null)
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
        reservation_id: (task as any).reservation_id ?? null,
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

// POST: thin wrapper around the createTask service.
//
// All validation, FK pre-checks, Tiptap synthesis, insert, and assignment
// fan-out live in src/server/tasks/createTask.ts so the agent and the UI
// produce identical rows. This handler's only job is mapping the body to
// the service input, mapping the service result back to the legacy UI
// response shape, and translating service error codes into HTTP statuses.
//
// Note on `property_name`: the service only accepts `property_id` (clean
// canonical contract). For backward compat, callers that historically sent
// only `property_name` (some UI surfaces still do at draft-creation time)
// have it resolved to a `property_id` here before the service is called.
// Note on `is_binned`: forwarded as an explicit hint when the caller sends
// it. The service falls back to deriving it from bin_id when omitted, but
// the explicit form lets the Bins kanban "New Task" button create orphan
// binned tasks (Task Bin) — a case the bin_id-only contract can't express.
export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Backward-compat: resolve property_name → property_id when the caller
    // didn't provide an id. New callers (the agent tool, future UI rewrites)
    // should pass property_id directly and skip this round-trip.
    let propertyId: string | null | undefined = body?.property_id ?? undefined;
    if (
      !propertyId &&
      typeof body?.property_name === 'string' &&
      body.property_name.length > 0
    ) {
      const { data: prop } = await getSupabaseServer()
        .from('properties')
        .select('id')
        .eq('name', body.property_name)
        .maybeSingle();
      propertyId = prop?.id ?? undefined;
    }

    const result = await createTask({
      title: body?.title,
      description: body?.description,
      status: body?.status,
      priority: body?.priority,
      scheduled_date: body?.scheduled_date,
      scheduled_time: body?.scheduled_time,
      property_id: propertyId,
      bin_id: body?.bin_id,
      // Forward an explicit is_binned so the Bins kanban "New Task" button
      // can land tasks in the Task Bin (binned, no specific sub-bin) — a
      // case the {bin_id-only} contract can't express on its own.
      is_binned: typeof body?.is_binned === 'boolean' ? body.is_binned : undefined,
      department_id: body?.department_id,
      template_id: body?.template_id,
      assigned_user_ids: body?.assigned_user_ids,
    });

    if (!result.ok) {
      const status =
        result.error.code === 'invalid_input'
          ? 400
          : result.error.code === 'not_found'
            ? 404
            : 500;
      return NextResponse.json({ error: result.error.message }, { status });
    }

    return NextResponse.json({
      success: true,
      data: toLegacyResponseShape(result.task),
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Failed to create task';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Translate the canonical CreatedTask into the response shape the existing
// UI consumers (TasksWindow, ProjectsWindow, PropertyTasksView) already
// expect. New consumers should prefer the canonical CreatedTask shape; this
// wrapper exists purely to avoid a UI-layer refactor in the same change.
function toLegacyResponseShape(t: CreatedTask) {
  return {
    id: t.task_id,
    property_name: t.property_name,
    property_id: t.property_id,
    reservation_id: t.reservation_id,
    bin_id: t.bin_id,
    is_binned: t.is_binned,
    template_id: t.template_id,
    template_name: t.template_name,
    title: t.title || 'Untitled Task',
    description: t.description,
    status: t.status,
    priority: t.priority,
    department_id: t.department_id,
    department_name: t.department_name,
    scheduled_date: t.scheduled_date,
    scheduled_time: t.scheduled_time,
    form_metadata: t.form_metadata,
    created_at: t.created_at,
    updated_at: t.updated_at,
    completed_at: t.completed_at,
    unread_comment_count: 0,
    project_assignments: t.assigned_users.map((a) => ({
      user_id: a.user_id,
      assigned_at: a.assigned_at ?? null,
      users: {
        id: a.user_id,
        name: a.name,
        email: a.email ?? null,
        role: a.role,
        avatar: a.avatar ?? null,
      },
      user: {
        id: a.user_id,
        name: a.name,
        email: a.email ?? null,
        role: a.role,
        avatar: a.avatar ?? null,
      },
    })),
  };
}
