-- Notifications V1: native inbox + optional Slack DMs.
--
-- This is intentionally separate from configurable automations. These rows
-- represent hard-coded product notifications with per-user delivery
-- preferences; legacy slack_automations remain in place for the reservation
-- runtime until that engine is rebuilt.

begin;

create table if not exists public.notifications (
  id              uuid primary key default gen_random_uuid(),
  type            text not null check (
    type in (
      'task_created_assigned',
      'task_assigned',
      'task_commented',
      'task_schedule_changed',
      'task_status_changed',
      'task_due_today'
    )
  ),
  user_id         text not null references public.users(id) on delete cascade,
  actor_user_id   text references public.users(id) on delete set null,
  entity_type     text not null,
  entity_id       uuid not null,
  title           text not null,
  body            text not null default '',
  href            text,
  metadata        jsonb not null default '{}'::jsonb,
  native_visible  boolean not null default true,
  read_at         timestamptz,
  slack_sent_at   timestamptz,
  slack_error     text,
  dedupe_key      text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, read_at, created_at desc)
  where native_visible = true;

create index if not exists notifications_entity_idx
  on public.notifications (entity_type, entity_id);

create table if not exists public.notification_preferences (
  id              uuid primary key default gen_random_uuid(),
  user_id         text not null references public.users(id) on delete cascade,
  type            text not null check (
    type in (
      'task_created_assigned',
      'task_assigned',
      'task_commented',
      'task_schedule_changed',
      'task_status_changed',
      'task_due_today'
    )
  ),
  native_enabled  boolean not null default true,
  slack_enabled   boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, type)
);

create index if not exists notification_preferences_user_idx
  on public.notification_preferences (user_id);

alter table public.notifications enable row level security;
alter table public.notification_preferences enable row level security;

drop policy if exists "Users can read own notifications" on public.notifications;
drop policy if exists "Users can update own notifications" on public.notifications;
drop policy if exists "Users can read own notification preferences" on public.notification_preferences;
drop policy if exists "Users can write own notification preferences" on public.notification_preferences;

-- Direct client access is intentionally not granted in V1. The app reads and
-- writes notifications through server API routes backed by the service role,
-- so RLS stays enabled without depending on optional auth-link columns.

commit;
