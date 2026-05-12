export const NOTIFICATION_TYPES = [
  'task_created_assigned',
  'task_assigned',
  'task_commented',
  'task_schedule_changed',
  'task_status_changed',
  'task_due_today',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  task_created_assigned: 'New assigned task',
  task_assigned: 'Task assigned',
  task_commented: 'Task comment',
  task_schedule_changed: 'Schedule changed',
  task_status_changed: 'Status changed',
  task_due_today: 'Due today',
};

export const NOTIFICATION_TYPE_DESCRIPTIONS: Record<NotificationType, string> = {
  task_created_assigned: 'A task is created and assigned to you.',
  task_assigned: 'An existing task is assigned to you.',
  task_commented: 'Someone comments on a task assigned to you.',
  task_schedule_changed: 'The scheduled date or time changes on a task assigned to you.',
  task_status_changed: 'The status changes on a task assigned to you.',
  task_due_today: 'A task assigned to you has a scheduled date of today.',
};

export interface NotificationPreference {
  type: NotificationType;
  native_enabled: boolean;
  slack_enabled: boolean;
}

export interface NotificationRecord {
  id: string;
  type: NotificationType;
  user_id: string;
  actor_user_id: string | null;
  entity_type: string;
  entity_id: string;
  title: string;
  body: string;
  href: string | null;
  metadata: Record<string, unknown>;
  native_visible: boolean;
  read_at: string | null;
  slack_sent_at: string | null;
  slack_error: string | null;
  created_at: string;
}

export function defaultNotificationPreference(
  type: NotificationType,
): NotificationPreference {
  return {
    type,
    native_enabled: true,
    slack_enabled: false,
  };
}
