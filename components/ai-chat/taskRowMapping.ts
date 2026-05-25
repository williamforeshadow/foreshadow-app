import type { TaskRow as AgentTaskRow } from '@/src/agent/tools/findTasks';
import type { TaskRowItem } from '@/components/tasks/TaskRow';

// Adapt a find_tasks row into the shape the shared <TaskRow /> component
// renders. Sibling to taskCardMapping.ts — this one targets the row format
// used on the My Assignments and Tasks pages (rather than the kanban-card
// format used inline at small N).
//
// Field mapping is nearly 1:1; two notes:
// - `assigned_users` (agent shape: { user_id, name, role }) → `assignees`
//   (row shape: { user_id, name, avatar }). The shapes are compatible
//   apart from the name and the missing `avatar` field — see below.
// - Avatars: find_tasks does not return avatar URLs today, so we pass
//   `avatar: null`. <TaskRow /> already falls back to initials, which
//   reads fine in the chat attachment for v1. Adding avatars to
//   find_tasks is a separate small enhancement.
export function taskRowToRowItem(t: AgentTaskRow): TaskRowItem {
  return {
    key: `task-${t.task_id}`,
    title: t.title ?? 'Untitled task',
    property_name: t.property_name,
    status: t.status,
    priority: t.priority || 'medium',
    department_id: t.department_id,
    department_name: t.department_name,
    scheduled_date: t.scheduled_date,
    scheduled_time: t.scheduled_time,
    assignees: t.assigned_users.map((u) => ({
      user_id: u.user_id,
      name: u.name,
      avatar: null,
    })),
    bin_id: t.bin_id,
    bin_name: t.bin_name,
    is_binned: t.is_binned,
    reservation_id: t.reservation_id,
    comment_count: t.comment_count,
  };
}
