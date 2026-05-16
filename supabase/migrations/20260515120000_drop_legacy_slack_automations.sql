-- Drop the legacy slack-automations engine.
--
-- The new engine (`automations` table + src/server/automations/*) fully
-- replaces this. The 4 legacy HOA/new-resident rules were intentionally
-- deleted with the user's authorization (2026-05-15) — they're being
-- rebuilt in the new engine. No DB triggers/functions referenced these
-- tables (legacy automations were app-fired only), so the drop is clean.
--
-- Attachment FILES are preserved: the `slack-automation-attachments`
-- Storage bucket is untouched and still referenced by the new runtime.
--
-- Children first (they FK slack_automations on delete cascade, but explicit
-- ordered drops are clearer than relying on cascade).

begin;

drop table if exists public.slack_automation_deliveries;
drop table if exists public.slack_automation_fires;
drop table if exists public.slack_automations;

commit;
