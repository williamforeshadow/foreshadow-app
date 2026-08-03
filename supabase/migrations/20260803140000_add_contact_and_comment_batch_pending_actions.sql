-- Batch pending-action kinds for the contact and comment fan-out tools, so one
-- Confirm commits the whole list. Without these the insert fails the CHECK and
-- the preview returns a null pending_action_id, which on Slack means no Confirm
-- button renders at all.
alter table public.agent_pending_actions
  drop constraint if exists agent_pending_actions_action_kind_check;

alter table public.agent_pending_actions
  add constraint agent_pending_actions_action_kind_check
  check (
    action_kind in (
      'create_task',
      'update_task',
      'delete_task',
      'create_tasks_batch',
      'update_tasks_batch',
      'create_bin',
      'add_comment',
      'add_comments_batch',
      'property_knowledge_write',
      'property_knowledge_batch',
      'property_note_upsert',
      'property_note_delete',
      'property_contact_upsert',
      'property_contact_delete',
      'property_contact_batch',
      'slack_file_attachment'
    )
  );
