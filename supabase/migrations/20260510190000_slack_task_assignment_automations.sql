-- Slack automation storage coverage + task-assignment delivery log.
-- Idempotent because some environments already have the original
-- slack_automations/slack_automation_fires tables from manual setup.

create table if not exists public.slack_automations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  enabled boolean not null default true,
  trigger text not null,
  property_ids uuid[] not null default '{}',
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.slack_automations
  drop constraint if exists slack_automations_trigger_check;

alter table public.slack_automations
  add constraint slack_automations_trigger_check
  check (trigger in ('new_booking', 'check_in', 'check_out', 'task_assigned'));

create table if not exists public.slack_automation_fires (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.slack_automations(id) on delete cascade,
  reservation_id uuid not null,
  trigger text not null,
  fired_at timestamptz not null default now(),
  unique (automation_id, reservation_id, trigger)
);

create table if not exists public.slack_automation_deliveries (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.slack_automations(id) on delete cascade,
  trigger text not null,
  entity_type text not null,
  entity_id uuid not null,
  recipient_user_id text null references public.users(id) on delete set null,
  recipient_email text null,
  event_signature text not null,
  delivered_at timestamptz not null default now(),
  unique (
    automation_id,
    trigger,
    entity_type,
    entity_id,
    recipient_user_id,
    event_signature
  )
);

create index if not exists slack_automations_trigger_enabled_idx
  on public.slack_automations (trigger, enabled);

create index if not exists slack_automation_deliveries_entity_idx
  on public.slack_automation_deliveries (entity_type, entity_id);
