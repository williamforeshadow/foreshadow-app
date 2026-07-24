import type { Task, ProjectStatus, ProjectPriority } from '@/lib/types';
import type { DraggableProjectItem } from '@/components/windows/projects/ProjectCard';

// Adapt a Schedule Task into the shape the kanban ProjectCard renders, so the
// Timeline's expanded-row task list matches the cards used on the bins board,
// in Messages (proposed / associated tasks), and in the AI chat. Mirrors
// ai-chat/taskCardMapping.ts (taskRowToCardItem) for a different source shape.
//
// Task carries no created_at/updated_at/completed_at — the card only reads
// completed_at for a binned auto-dismiss countdown (not shown here), so empty
// strings are safe placeholders for the required Project timestamps.
export function scheduleTaskToCardItem(task: Task): DraggableProjectItem {
  return {
    id: task.task_id,
    columnId: 'schedule',
    project: {
      id: task.task_id,
      property_id: task.property_id ?? null,
      property_name: task.property_name ?? null,
      bin_id: task.bin_id ?? null,
      is_binned: task.is_binned,
      template_id: task.template_id,
      template_name: task.template_name,
      title: task.title || task.template_name || 'Task',
      description: task.description ?? null,
      status: task.status as ProjectStatus,
      priority: (task.priority || 'medium') as ProjectPriority,
      department_id: task.department_id ?? null,
      department_name: task.department_name ?? null,
      scheduled_date: task.scheduled_date ?? null,
      scheduled_time: task.scheduled_time ?? null,
      reservation_id: task.reservation_id ?? null,
      form_metadata: task.form_metadata,
      project_assignments: (task.assigned_users ?? []).map((u) => ({
        user_id: u.user_id,
        user: {
          id: u.user_id,
          name: u.name,
          avatar: u.avatar,
          role: u.role,
        },
      })),
      created_at: '',
      updated_at: '',
      completed_at: null,
    },
  };
}
