-- A single guest message can legitimately raise MULTIPLE distinct tasks (e.g.
-- "the stove is broken and the backyard is a mess" → two tasks). The original
-- partial unique index allowed only one pending proposal per triggering message,
-- which capped that. Drop it. Dedup is now semantic — the triage prompt is shown
-- the conversation's already-raised task titles and won't repeat them.

begin;

drop index if exists public.proposed_tasks_pending_per_message;

commit;
