-- Multi-tenant P1: operations_settings singleton (id=1) → one row per org.
--
-- The table was a hardcoded singleton (id defaulted to the literal 1). Give it a
-- unique(org_id) so the route can upsert per-org, move id onto a sequence so new
-- orgs get distinct ids, and seed org 2's row from org 1's values.

begin;

-- Drop the old singleton guard (CHECK (id = 1)) so per-org rows are allowed.
alter table public.operations_settings drop constraint if exists operations_settings_singleton;

alter table public.operations_settings
  add constraint operations_settings_org_id_key unique (org_id);

create sequence if not exists public.operations_settings_id_seq
  owned by public.operations_settings.id;
select setval('public.operations_settings_id_seq',
              greatest(1, (select coalesce(max(id), 1) from public.operations_settings)));
alter table public.operations_settings
  alter column id set default nextval('public.operations_settings_id_seq');

insert into public.operations_settings (
  org_id, default_check_in_time, default_check_out_time, default_timezone,
  task_proposal_sensitivity, reply_proposal_sensitivity,
  reply_proposal_enabled, task_proposal_enabled, knowledge_proposal_enabled,
  concierge_tool_settings
)
select (select id from public.organizations where slug = 'kubanda-hospitable'),
       s.default_check_in_time, s.default_check_out_time, s.default_timezone,
       s.task_proposal_sensitivity, s.reply_proposal_sensitivity,
       s.reply_proposal_enabled, s.task_proposal_enabled, s.knowledge_proposal_enabled,
       s.concierge_tool_settings
from public.operations_settings s
where s.org_id = (select id from public.organizations where slug = 'kubanda-hostaway')
on conflict (org_id) do nothing;

commit;
