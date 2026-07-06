-- Multi-tenant P5: drop the org-1 org_id DEFAULT (the P1 bridge).
--
-- With the derive_org_id triggers in place, a missing org_id now either derives
-- from the row's parent FK or fails loudly — instead of silently landing in
-- org 1. Explicit org_id (sync/ingest/routes) still wins. Kept ONLY on
-- ai_chat_messages (agent-chat log, no clean tenant parent) as a fallback.

begin;

do $$
declare
  t text;
  tables text[] := array[
    'agent_pending_actions','automation_deliveries','automation_presets',
    'automations','calendar_blocks','concierge_training','concierge_training_examples',
    'concierge_training_properties','conversations','departments','device_tokens',
    'guest_messages','notification_preferences','notification_property_preferences',
    'notifications','operations_settings','project_activity_log','project_assignments',
    'project_attachments','project_bins','project_comments','project_time_entries',
    'project_views','properties','property_access','property_attribute_photos',
    'property_attributes','property_connectivity','property_contacts','property_documents',
    'property_knowledge_activity_log','property_knowledge_visibility','property_listings',
    'property_projects','property_room_photos','property_rooms','property_tech_account_photos',
    'property_tech_accounts','property_templates','proposed_knowledge','proposed_tasks',
    'reservations','slack_inbound_files','task_assignments','templates','turnover_tasks',
    'user_departments','users'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I alter column org_id drop default', t);
  end loop;
end $$;

commit;
