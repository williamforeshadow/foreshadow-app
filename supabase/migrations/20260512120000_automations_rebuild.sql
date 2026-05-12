-- Automations engine rebuild — additive migration.
--
-- Adds the new `automations` + `automation_deliveries` tables. The old
-- `slack_automations` / `slack_automation_fires` / `slack_automation_deliveries`
-- tables are intentionally left in place so the production new-booking
-- (HOA form) automations keep firing under the old engine while the new
-- engine is being built. They get dropped in a follow-up migration once
-- those rules are rebuilt in the new shape and verified.
--
-- Confirmed with Billy on 2026-05-11.

begin;

create table if not exists automations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  enabled       boolean not null default true,
  trigger       jsonb not null,
  conditions    jsonb not null default '{"kind":"group","match":"all","children":[]}'::jsonb,
  actions       jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists automations_enabled_idx on automations (enabled);
create index if not exists automations_trigger_kind_idx on automations ((trigger->>'kind'));
create index if not exists automations_trigger_entity_idx on automations ((trigger->>'entity'))
  where (trigger->>'kind') = 'row_change';

-- Delivery dedup.
-- One row per (automation, signature, recipient). The signature is built
-- by the runner: for row_change it's typically "<kind>:<entity_id>"; for
-- schedule it's "<localDate>:<scheduleTime>:<entity_id>". Unique
-- constraint prevents the daily cron from firing twice if it runs more
-- than once.
create table if not exists automation_deliveries (
  id              uuid primary key default gen_random_uuid(),
  automation_id   uuid not null references automations(id) on delete cascade,
  event_signature text not null,
  recipient_key   text not null,
  delivered_at    timestamptz not null default now(),
  unique (automation_id, event_signature, recipient_key)
);

create index if not exists automation_deliveries_automation_idx
  on automation_deliveries (automation_id);

commit;
