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

// Conversation-scoped proposal notifications. Kept SEPARATE from
// NOTIFICATION_TYPES on purpose: that array drives the global notification-
// preferences UI/API/loader, where absence of a row means the ON defaults.
// These two types are per-property OPT-IN (absence = off) and live in the
// notification_property_preferences table instead, so mixing them into the
// global list would break their semantics.
export const PROPERTY_NOTIFICATION_TYPES = [
  'proposed_task',
  'proposed_reply',
] as const;

export type PropertyNotificationType =
  (typeof PROPERTY_NOTIFICATION_TYPES)[number];

/** Union of every value the `notifications.type` column may hold. */
export type AnyNotificationType = NotificationType | PropertyNotificationType;

export const PROPERTY_NOTIFICATION_TYPE_LABELS: Record<
  PropertyNotificationType,
  string
> = {
  proposed_task: 'Proposed tasks',
  proposed_reply: 'Proposed replies',
};

export const PROPERTY_NOTIFICATION_TYPE_DESCRIPTIONS: Record<
  PropertyNotificationType,
  string
> = {
  proposed_task:
    'The concierge drafts an operational task from a guest message at this property.',
  proposed_reply:
    'The concierge drafts a reply to a guest message at this property.',
};

export interface PropertyNotificationPreference {
  property_id: string;
  type: PropertyNotificationType;
  native_enabled: boolean;
  slack_enabled: boolean;
  push_enabled: boolean;
}

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
  /** Send a real mobile push (APNs) to the user's registered devices. */
  push_enabled: boolean;
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
    push_enabled: true,
    due_today_time: type === 'task_due_today' ? DEFAULT_DUE_TODAY_TIME : null,
  };
}
