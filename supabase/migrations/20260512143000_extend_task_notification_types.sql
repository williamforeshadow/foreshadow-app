-- Notifications V1 follow-up: add task field/attachment event types.
--
-- The original notifications migration has already run in production, so this
-- extends the existing check constraints in place instead of editing history.

begin;

alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (
    type in (
      'task_created_assigned',
      'task_assigned',
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
