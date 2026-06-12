-- Allow the 'proposed_knowledge' conversation-scoped notification type. Like the
-- other proposal types it's per-property opt-in (notification_property_preferences),
-- never in the global notification_preferences — so that CHECK is left untouched.

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
      'task_description_changed',
      'proposed_task',
      'proposed_reply',
      'proposed_knowledge'
    )
  );

commit;
