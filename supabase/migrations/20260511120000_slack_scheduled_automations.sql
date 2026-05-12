alter table public.slack_automations
  drop constraint if exists slack_automations_trigger_check;

alter table public.slack_automations
  add constraint slack_automations_trigger_check
  check (trigger in ('new_booking', 'check_in', 'check_out', 'task_assigned', 'scheduled'));
