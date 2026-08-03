-- Batch Property Knowledge writes register one pending action for the whole
-- fan-out (N properties, optionally creating their rooms first) so a single
-- Confirm commits the lot. Without this kind the insert fails the CHECK and
-- preview_property_knowledge_batch silently returns a null pending_action_id,
-- which on Slack means no Confirm button renders at all.

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
      'property_knowledge_write',
      'property_knowledge_batch',
      'property_note_upsert',
      'property_note_delete',
      'property_contact_upsert',
      'property_contact_delete',
      'slack_file_attachment'
    )
  );
