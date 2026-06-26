-- Proposed tasks can now carry a suggested schedule. Stored as text in the
-- canonical task formats (date 'YYYY-MM-DD', time 'HH:MM' 24h) so the validated
-- strings round-trip cleanly into createTask on accept. Null = unscheduled.
alter table public.proposed_tasks
  add column if not exists scheduled_date text,
  add column if not exists scheduled_time text;
