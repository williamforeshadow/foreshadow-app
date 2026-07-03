-- Multi-tenant P2: arm RLS on the anon-read tables that P1 deferred.
--
-- These 17 tables already have the `org_isolation` policy defined (P1) and
-- org_id NOT NULL; P1 kept RLS DISABLED on them so the deployed (old) code's
-- direct browser anon reads (get_property_turnovers RPC + a turnover_tasks
-- select in useTimeline) kept working. The branch now routes those reads
-- through /api (user-scoped client), so we can arm RLS. Enabling RLS activates
-- the already-defined per-org policies — the crown-jewel tables become fully
-- org-isolated.
--
-- Deploy note: arming these BLANKS the deployed app's direct anon reads until
-- the branch is deployed. Intentional here (app not in active use).

begin;

do $$
declare
  t text;
  armed text[] := array[
    'reservations','templates','property_templates','turnover_tasks',
    'property_projects','ai_chat_messages','users','task_assignments',
    'project_assignments','project_attachments','project_time_entries',
    'project_activity_log','project_views','automation_presets',
    'departments','properties','project_bins'
  ];
begin
  foreach t in array armed loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Lock down the empty legacy tables: drop their wide-open public policies so
-- they're deny-all to anon/authenticated (service-role only). Both are unused
-- (0 rows); their app code was removed long ago.
drop policy if exists "Allow all access to channels" on public.channels;
drop policy if exists "Allow all access to messages" on public.messages;

commit;
