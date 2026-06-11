-- Per-property notification preferences for the two CONVERSATION-scoped proposal
-- notifications: 'proposed_task' and 'proposed_reply'. These are opt-IN and
-- scoped per property — unlike the global notification_preferences (keyed by
-- type only, defaulting ON for task assignees).
--
-- Opt-in semantics: NO ROW = OFF. A row's existence means the user opted in for
-- that (property, type); its three booleans are the channel choices. The
-- recipient query selects existing rows only, so absence excludes the user.
-- The API deletes the row when all three channels are turned off, keeping this
-- invariant clean and the recipient lookup cheap.
--
-- There is no user<->property membership table today (every user can see every
-- property), so the preference row itself doubles as the opt-in/membership.

begin;

create table if not exists public.notification_property_preferences (
  id              uuid primary key default gen_random_uuid(),
  user_id         text not null references public.users(id) on delete cascade,
  property_id     uuid not null references public.properties(id) on delete cascade,
  type            text not null check (type in ('proposed_task', 'proposed_reply')),
  native_enabled  boolean not null default true,
  slack_enabled   boolean not null default false,
  push_enabled    boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, property_id, type)
);

-- Recipient resolution keys off (property_id, type).
create index if not exists notification_property_preferences_lookup_idx
  on public.notification_property_preferences (property_id, type);

alter table public.notification_property_preferences enable row level security;
-- Intentionally NO policies: service-role access through API routes only.

commit;
