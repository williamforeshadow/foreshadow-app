begin;

-- Guest messaging v1 — first building block.
--
-- Ingests guest<->host messages from Hostaway (via the messages webhook) and
-- stores them workspace-globally (no per-user scoping — any authed manager sees
-- all). Mirrors the notifications_v1 conventions: uuid PK, timestamptz defaults,
-- jsonb metadata, a unique dedup key, and RLS enabled with NO client policies
-- (all access is service-role through API routes).
create table if not exists public.guest_messages (
  id                       uuid primary key default gen_random_uuid(),
  -- Nullable: a message can arrive before its reservation has synced. We insert
  -- it anyway (reservation_id null) and can back-link later.
  reservation_id           uuid references public.reservations(id) on delete set null,
  hostaway_conversation_id text,
  -- Dedup key. Unique so re-ingest (Hostaway retries, redelivery) is idempotent.
  hostaway_message_id      text not null unique,
  -- Denormalized snapshot so the inbox list renders without joins.
  property_name            text,
  guest_name               text,
  direction                text not null default 'inbound'
                             check (direction in ('inbound', 'outbound')),
  body                     text not null default '',
  sent_at                  timestamptz,
  metadata                 jsonb not null default '{}'::jsonb,
  created_at               timestamptz not null default now()
);

create index if not exists guest_messages_sent_at_idx
  on public.guest_messages (sent_at desc);

create index if not exists guest_messages_reservation_id_idx
  on public.guest_messages (reservation_id);

alter table public.guest_messages enable row level security;
-- Intentionally NO policies: all access is service-role through API routes.

commit;
