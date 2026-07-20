import type { Project, ProjectFormFields, User } from '@/lib/types';

// The unified task-detail input shape. Generalizes OverlayTaskInput
// (PropertyTaskDetailOverlay) — every surface adapts its row into this before
// mounting TaskDetailPanel. One id space: task_id === turnover_tasks.id.
export interface TaskDetailInput {
  task_id: string;
  reservation_id: string | null;
  property_id: string | null;
  property_name: string | null;
  template_id: string | null;
  template_name: string | null;
  title: string | null;
  description: unknown;
  priority: string;
  department_id: string | null;
  department_name: string | null;
  status: string;
  scheduled_date: string | null;
  scheduled_time: string | null;
  form_metadata: Record<string, unknown> | null;
  bin_id: string | null;
  bin_name?: string | null;
  is_binned: boolean;
  created_at: string;
  updated_at: string;
  assigned_users: {
    user_id: string;
    name: string;
    avatar: string | null;
    role?: string;
  }[];
  /** Optional — list rows from tasks-for-bin carry it; drives the comments dot. */
  unread_comment_count?: number;
}

// Adapt a Project row (kanban / tasks-for-bin shape: `id`, project_assignments)
// into TaskDetailInput. Some rows carry project_assignments without joined
// user objects — fall back to the users list for names/avatars.
export function projectToTaskInput(project: Project, users: User[]): TaskDetailInput {
  const assigned = (project.project_assignments ?? []).map((a) => {
    const joined = (a as { user?: { id: string; name: string; avatar?: string | null; role?: string } }).user;
    const fallback = users.find((u) => u.id === a.user_id);
    return {
      user_id: a.user_id,
      name: joined?.name ?? fallback?.name ?? '',
      avatar: joined?.avatar ?? fallback?.avatar ?? null,
      role: joined?.role ?? fallback?.role,
    };
  });
  return {
    task_id: project.id,
    reservation_id: project.reservation_id ?? null,
    property_id: project.property_id ?? null,
    property_name: project.property_name ?? null,
    template_id: project.template_id ?? null,
    template_name: project.template_name ?? null,
    title: project.title ?? null,
    description: project.description ?? null,
    priority: project.priority ?? 'medium',
    department_id: project.department_id ?? null,
    department_name: project.department_name ?? null,
    status: project.status ?? 'not_started',
    scheduled_date: project.scheduled_date ?? null,
    scheduled_time: project.scheduled_time ?? null,
    form_metadata: (project.form_metadata as Record<string, unknown> | null) ?? null,
    bin_id: project.bin_id ?? null,
    bin_name: (project as { bin_name?: string | null }).bin_name ?? null,
    is_binned: project.is_binned ?? false,
    created_at: project.created_at,
    updated_at: project.updated_at,
    assigned_users: assigned,
    unread_comment_count: (project as { unread_comment_count?: number }).unread_comment_count,
  };
}

export function buildFields(task: TaskDetailInput): ProjectFormFields {
  return {
    title: task.title || task.template_name || 'Task',
    description: (task.description as ProjectFormFields['description']) ?? null,
    status: (task.status as ProjectFormFields['status']) || 'not_started',
    priority: (task.priority as ProjectFormFields['priority']) || 'medium',
    assigned_staff: task.assigned_users.map((u) => u.user_id),
    department_id: task.department_id || '',
    scheduled_date: task.scheduled_date || '',
    scheduled_time: task.scheduled_time || '',
  };
}

