-- Add the `task_unassigned` notification type so users get notified when
-- someone removes them from a task.

begin;

alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (
    type in (
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
      'task_description_changed'
    )
  );

alter table public.notification_preferences
  drop constraint if exists notification_preferences_type_check;

alter table public.notification_preferences
  add constraint notification_preferences_type_check
  check (
    type in (
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
      'task_description_changed'
    )
  );

commit;
