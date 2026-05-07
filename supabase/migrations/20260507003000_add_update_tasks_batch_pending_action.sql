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
      'property_note_upsert',
      'property_note_delete',
      'property_contact_upsert',
      'property_contact_delete',
      'slack_file_attachment'
    )
  );
