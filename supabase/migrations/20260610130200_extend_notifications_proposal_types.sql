-- Allow the two conversation-scoped proposal notification types on the
-- notifications table. These are written by notifyProposal.ts (not the
-- assignee-based task path).
--
-- We deliberately do NOT touch notification_preferences_type_check: the
-- proposal types are per-property opt-in and live in
-- notification_property_preferences, never in the global notification_preferences.

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
      'proposed_reply'
    )
  );

commit;
