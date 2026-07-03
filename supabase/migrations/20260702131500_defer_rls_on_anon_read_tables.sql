-- Multi-tenant foundation — P1 correction: defer RLS on the anon-read tables.
--
-- The production Vercel app shares THIS database. The currently-deployed code
-- reads a few tables directly through the session-less browser anon client
-- (get_property_turnovers RPC — SECURITY INVOKER — and a direct turnover_tasks
-- select in lib/useTimeline.ts). Enabling RLS on those tables in P1 breaks that
-- read for the *deployed* app before the code fix (route reads through /api) is
-- shipped.
--
-- Fix: DISABLE RLS again on exactly the tables that were anon-open before P1,
-- restoring their pre-P1 behavior (no regression — org 2 has no data yet). The
-- org-isolation POLICIES created in P1 stay defined but dormant; P2 re-enables
-- RLS on these tables in the same deploy as the code that removes the anon reads.
--
-- The other ~32 tables (guest_messages, conversations, notifications, etc.) keep
-- RLS armed: they are only read via service-role /api routes, which bypass RLS,
-- so no deployed read breaks.

begin;

do $$
declare
  t text;
  anon_read_tables text[] := array[
    'reservations','templates','property_templates','turnover_tasks',
    'property_projects','ai_chat_messages','users','task_assignments',
    'project_assignments','project_attachments','project_time_entries',
    'project_activity_log','project_views','automation_presets',
    'departments','properties','project_bins'
  ];
begin
  foreach t in array anon_read_tables loop
    execute format('alter table public.%I disable row level security', t);
  end loop;
end $$;

commit;
