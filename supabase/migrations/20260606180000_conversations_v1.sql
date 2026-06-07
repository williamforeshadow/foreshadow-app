begin;

-- Canonical, PMS-agnostic conversations table. Holds per-conversation state that
-- no PMS payload provides (app_status tabs + unread highlight) and booking/channel
-- snapshots so filters work even when there's no reservation row (inquiries) or it
-- was deleted (cancelled). Mirrors notifications/guest_messages conventions:
-- RLS enabled, NO client policies (service-role via API routes only).
create table if not exists public.conversations (
  id                       uuid primary key default gen_random_uuid(),
  source                   text not null default 'hostaway',
  external_conversation_id text not null,
  guest_name               text,
  property_id              uuid references public.properties(id) on delete set null,
  property_name            text,
  channel                  text,                       -- canonical channel key
  reservation_id           uuid references public.reservations(id) on delete set null,
  booking_state            text not null default 'inquiry'
                             check (booking_state in ('inquiry','booked','cancelled')),
  check_in                 date,                       -- snapshot (survives reservation deletion)
  check_out                date,
  last_message_at          timestamptz,
  last_direction           text check (last_direction in ('inbound','outbound')),
  last_message_preview     text not null default '',
  message_count            integer not null default 0,
  app_status               text not null default 'active'
                             check (app_status in ('active','complete')),  -- the two tabs
  unread                   boolean not null default true,                  -- highlight within Active
  archived                 boolean not null default false,
  source_status_raw        text,                       -- raw PMS status (debug/audit)
  metadata                 jsonb not null default '{}'::jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (source, external_conversation_id)
);

create index if not exists conversations_status_idx
  on public.conversations (app_status, last_message_at desc);
create index if not exists conversations_unread_idx
  on public.conversations (unread) where unread;
create index if not exists conversations_property_idx
  on public.conversations (property_id);
create index if not exists conversations_booking_state_idx
  on public.conversations (booking_state);

alter table public.conversations enable row level security;

alter table public.guest_messages
  add column if not exists conversation_id uuid references public.conversations(id) on delete cascade;
create index if not exists guest_messages_conversation_id_idx
  on public.guest_messages (conversation_id);

commit;
