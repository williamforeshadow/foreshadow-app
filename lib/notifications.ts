export const NOTIFICATION_TYPES = [
  'task_created_assigned',
  'task_assigned',
  'task_unassigned',
  'task_commented',
  'task_schedule_changed',
  'task_status_changed',
  'task_due_today',
  'task_bin_changed',
  'task_attachment_added',
  'task_title_changed',
  'task_priority_changed',
  'task_description_changed',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  task_created_assigned: 'New assigned task',
  task_assigned: 'Task assigned',
  task_unassigned: 'Task unassigned',
  task_commented: 'Task comment',
  task_schedule_changed: 'Schedule changed',
  task_status_changed: 'Status changed',
  task_due_today: 'Due today',
  task_bin_changed: 'Bin changed',
  task_attachment_added: 'Attachment added',
  task_title_changed: 'Title changed',
  task_priority_changed: 'Priority changed',
  task_description_changed: 'Description updated',
};

export const NOTIFICATION_TYPE_DESCRIPTIONS: Record<NotificationType, string> = {
  task_created_assigned: 'A task is created and assigned to you.',
  task_assigned: 'An existing task is assigned to you.',
  task_unassigned: 'You are removed from a task that was previously assigned to you.',
  task_commented: 'Someone comments on a task assigned to you.',
  task_schedule_changed: 'The scheduled date or time changes on a task assigned to you.',
  task_status_changed: 'The status changes on a task assigned to you.',
  task_due_today: 'A task assigned to you has a scheduled date of today.',
  task_bin_changed: 'A task assigned to you is moved into, out of, or between bins.',
  task_attachment_added: 'Someone adds an attachment to a task assigned to you.',
  task_title_changed: 'The title changes on a task assigned to you.',
  task_priority_changed: 'The priority changes on a task assigned to you.',
  task_description_changed: 'The description changes on a task assigned to you.',
};

export interface NotificationPreference {
  type: NotificationType;
  native_enabled: boolean;
  slack_enabled: boolean;
  /**
   * Wall-clock hour (HH:MM) in the org's default timezone at which the
   * task_due_today reminder fires. Only meaningful when type === 'task_due_today'.
   * NULL → DEFAULT_DUE_TODAY_TIME.
   */
  due_today_time?: string | null;
}

/** Default firing time for task_due_today, in org timezone. */
export const DEFAULT_DUE_TODAY_TIME = '08:00';

export interface NotificationRecord {
  id: string;
  type: NotificationType;
  user_id: string;
  actor_user_id: string | null;
  actor_name: string | null;
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
    due_today_time: type === 'task_due_today' ? DEFAULT_DUE_TODAY_TIME : null,
  };
}
