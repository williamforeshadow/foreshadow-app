-- Multi-tenant P4: generic guest_messages identity for multi-PMS.
--
-- guest_messages dedups on hostaway_message_id (Hostaway-specific). Add generic
-- source + external_message_id so Hospitable (and future PMSes) can dedup too,
-- keyed per org. Backfill existing Hostaway rows. Additive — the Hostaway
-- ingest/webhook keep using hostaway_message_id; the new unique index tolerates
-- their null external_message_id (nulls are distinct).

begin;

alter table public.guest_messages
  add column if not exists source text not null default 'hostaway';
alter table public.guest_messages
  add column if not exists external_message_id text;

-- Backfill existing rows so the generic id mirrors the Hostaway one.
update public.guest_messages
  set external_message_id = hostaway_message_id
  where external_message_id is null and hostaway_message_id is not null;

create unique index if not exists guest_messages_org_source_extid_uq
  on public.guest_messages (org_id, source, external_message_id);

commit;
