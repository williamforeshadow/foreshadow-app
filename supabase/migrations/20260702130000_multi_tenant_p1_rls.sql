-- Multi-tenant foundation — Phase 1 (RLS enforcement).
--
-- Turns on real per-org isolation at the database layer:
--   * static DEFAULT = org 1 on every tenant table (bridge: any insert path not
--     yet org-aware lands in org 1 — correct while org 2 is empty; REMOVED in P3
--     once every writer sets org_id explicitly)
--   * org_id NOT NULL (safe now because of the default)
--   * enable RLS + a uniform FOR ALL policy keyed on app_current_user_orgs()
--     on every tenant table, plus organizations + org_memberships
--
-- Service-role (getSupabaseServer) BYPASSES these policies, so un-converted
-- system/API routes keep working unchanged; the policies only bite once a
-- request runs through the user-scoped (cookie/anon) client. Because org 2 has
-- no data yet, nothing user-visible changes for org 1.
--
-- Coupled code change (same deploy): the 2 direct anon-key reads
-- (get_property_turnovers RPC + turnover_tasks read in lib/useTimeline.ts) must
-- move behind API routes, or they return 0 rows once RLS is on turnover_tasks.
--
-- Idempotent: drop-policy-if-exists before create; enable RLS is a no-op if on.

begin;

do $$
declare
  v_org1 uuid;
  t text;
  tenant_tables text[] := array[
    'agent_pending_actions','ai_chat_messages','automation_deliveries',
    'automation_presets','automations','calendar_blocks','concierge_training',
    'concierge_training_examples','concierge_training_properties','conversations',
    'departments','device_tokens','guest_messages','notification_preferences',
    'notification_property_preferences','notifications','operations_settings',
    'project_activity_log','project_assignments','project_attachments',
    'project_bins','project_comments','project_time_entries','project_views',
    'properties','property_access','property_attribute_photos','property_attributes',
    'property_connectivity','property_contacts','property_documents',
    'property_knowledge_activity_log','property_knowledge_visibility',
    'property_listings','property_projects','property_room_photos','property_rooms',
    'property_tech_account_photos','property_tech_accounts','property_templates',
    'proposed_knowledge','proposed_tasks','reservations','slack_inbound_files',
    'task_assignments','templates','turnover_tasks','user_departments','users'
  ];
begin
  select id into v_org1 from public.organizations where slug = 'kubanda-hostaway';

  foreach t in array tenant_tables loop
    -- DEFAULT bridge (removed in P3) + NOT NULL (safe because of the default)
    execute format('alter table public.%I alter column org_id set default %L', t, v_org1);
    execute format('update public.%I set org_id = %L where org_id is null', t, v_org1);
    execute format('alter table public.%I alter column org_id set not null', t);

    -- Enable RLS + uniform per-org policy
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists org_isolation on public.%I', t);
    execute format($p$
      create policy org_isolation on public.%I
        for all to authenticated
        using (org_id in (select public.app_current_user_orgs()))
        with check (org_id in (select public.app_current_user_orgs()))
    $p$, t);
  end loop;
end $$;

-- Org tables: a user can see their own org(s) and their own membership rows.
drop policy if exists org_self_read on public.organizations;
create policy org_self_read on public.organizations
  for select to authenticated
  using (id in (select public.app_current_user_orgs()));

drop policy if exists membership_self_read on public.org_memberships;
create policy membership_self_read on public.org_memberships
  for select to authenticated
  using (org_id in (select public.app_current_user_orgs()));

commit;
