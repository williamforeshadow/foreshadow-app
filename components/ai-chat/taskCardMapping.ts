import type { TaskRow } from '@/src/agent/tools/findTasks';
import type {
  DraggableProjectItem,
} from '@/components/windows/projects/ProjectCard';
import type { ProjectStatus, ProjectPriority } from '@/lib/types';

// Adapt a find_tasks row into the shape the kanban ProjectCard renders, so
// chat task cards are visually identical to the board. Lives here (not
// inside any specific chat component) because both the inline carousel
// (TaskCardCarousel) and the collapsible attachment (TaskAttachment) need
// the same mapping.
export function taskRowToCardItem(t: TaskRow): DraggableProjectItem {
  return {
    id: t.task_id,
    columnId: 'chat',
    project: {
      id: t.task_id,
      property_id: t.property_id,
      property_name: t.property_name,
      bin_id: t.bin_id,
      is_binned: t.is_binned,
      template_id: t.template_id,
      template_name: t.template_name,
      title: t.title ?? 'Untitled task',
      status: t.status as ProjectStatus,
      priority: (t.priority || 'medium') as ProjectPriority,
      department_id: t.department_id,
      department_name: t.department_name,
      scheduled_date: t.scheduled_date,
      scheduled_time: t.scheduled_time,
      reservation_id: t.reservation_id,
      project_assignments: t.assigned_users.map((u) => ({
        user_id: u.user_id,
        user: { id: u.user_id, name: u.name, role: u.role },
      })),
      created_at: t.created_at,
      updated_at: t.updated_at,
      completed_at: t.completed_at,
    },
  };
}
