-- Multi-tenant foundation — Phase 0 (non-breaking; app stays service-role).
--
-- Adds the tenancy spine WITHOUT changing any app behavior:
--   * organizations + org_memberships (seed org 1 = existing tenant, org 2 = new)
--   * app_current_user_orgs() — the SECURITY DEFINER helper every future RLS
--     policy will key on (auth.uid() -> users.auth_user_id -> org_memberships)
--   * a nullable org_id on every tenant table, backfilled to org 1, indexed
--   * property-name uniqueness re-scoped per-org (the one uniqueness that can
--     collide as soon as org 2 gets a similarly-named property)
--
-- NOT here (deferred by design):
--   * RLS policies / NOT NULL flips (Phase 1) — would change behavior
--   * re-scoping the PMS-external-id uniques (hostaway_message_id,
--     source+external_conversation_id, hostaway_listing_id,
--     hostaway_reservation_id) — those are live upsert onConflict targets, so
--     they move to Phase 3 alongside the webhook/sync code changes + org 2 data
--
-- Fully idempotent (if-not-exists / on-conflict-do-nothing) so it is safe to
-- apply more than once (e.g. MCP apply now + repo db-push later).

begin;

-- 1. Tenancy spine ----------------------------------------------------------

create table if not exists public.organizations (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  name       text not null,
  created_at timestamptz not null default now()
);
alter table public.organizations enable row level security;

-- user_id is TEXT to match users.id (which holds uuid-format strings typed text)
create table if not exists public.org_memberships (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  user_id    text not null references public.users(id) on delete cascade,
  role       text not null default 'member',
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);
alter table public.org_memberships enable row level security;
create index if not exists idx_org_memberships_user on public.org_memberships(user_id);
create index if not exists idx_org_memberships_org  on public.org_memberships(org_id);

insert into public.organizations (slug, name) values
  ('kubanda-hostaway',   'Kubanda-Hostaway')   on conflict (slug) do nothing;
insert into public.organizations (slug, name) values
  ('kubanda-hospitable', 'Kubanda-Hospitable') on conflict (slug) do nothing;

-- Existing users all belong to org 1. Preserve their app role on the membership.
insert into public.org_memberships (org_id, user_id, role)
select o.id, u.id, u.role
from public.users u
cross join public.organizations o
where o.slug = 'kubanda-hostaway'
on conflict (org_id, user_id) do nothing;

-- 2. Org-resolution helper --------------------------------------------------
-- auth.uid() (uuid) -> users.auth_user_id -> users.id -> org_memberships.org_id.
-- SECURITY DEFINER so it can read users/org_memberships regardless of the
-- caller's RLS (and so a future users RLS policy that calls this doesn't
-- recurse); STABLE so Postgres evaluates it once per statement (keeps the
-- policy predicate effectively O(1)); pinned search_path prevents hijack.
-- Returns SETOF so multi-org is a no-op change later.
create or replace function public.app_current_user_orgs()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.org_id
  from public.users u
  join public.org_memberships m on m.user_id = u.id
  where u.auth_user_id = auth.uid()
$$;

revoke all on function public.app_current_user_orgs() from public;
grant execute on function public.app_current_user_orgs() to authenticated;

create index if not exists idx_users_auth_user_id on public.users(auth_user_id);

-- 3. Nullable org_id on every tenant table, backfilled to org 1, indexed -----
-- Excludes: founding_signups (global marketing waitlist), channels/messages
-- (legacy/empty), and the org tables themselves.
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
    execute format(
      'alter table public.%I add column if not exists org_id uuid references public.organizations(id)', t);
    execute format(
      'update public.%I set org_id = %L where org_id is null', t, v_org1);
    execute format(
      'create index if not exists %I on public.%I(org_id)', 'idx_' || t || '_org_id', t);
  end loop;
end $$;

-- 4. Re-scope property-name uniqueness per org ------------------------------
-- Was a global unique index on lower(name); two orgs must be allowed the same
-- property name. Not an upsert onConflict target, so safe to change now.
drop index if exists public.properties_name_unique_ci;
create unique index if not exists properties_org_name_unique_ci
  on public.properties (org_id, lower(name));

commit;
