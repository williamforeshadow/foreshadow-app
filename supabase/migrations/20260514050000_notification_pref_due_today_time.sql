-- Per-user wall-clock hour (in the org's default timezone) at which the
-- task_due_today reminder should fire. NULL means "use the application
-- default" (DEFAULT_DUE_TODAY_TIME, currently 08:00). Only meaningful for
-- rows where type = 'task_due_today'.

alter table public.notification_preferences
  add column if not exists due_today_time text
  check (due_today_time is null or due_today_time ~ '^[0-2][0-9]:[0-5][0-9]$');
