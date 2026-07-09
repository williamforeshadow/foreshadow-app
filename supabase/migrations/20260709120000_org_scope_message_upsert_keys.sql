-- Multi-tenant: re-scope the PMS-external-id dedup uniques on conversations
-- and guest_messages to include org_id.
--
-- These were the last of the "PMS-external-id uniques" the P0 foundation
-- migration explicitly deferred (see 20260702120000 header: "re-scoping the
-- PMS-external-id uniques ... move to Phase 3 alongside the webhook/sync code
-- changes"). Today the conversations dedup key is (source,
-- external_conversation_id) and the guest_messages Hostaway dedup key is
-- (hostaway_message_id) — both GLOBAL, not per-org. That means an upsert from
-- org B carrying the same external id as an existing org A row would MATCH and
-- overwrite org A's row (potentially flipping its org_id) instead of creating a
-- distinct row. It cannot happen today because Hostaway ids are globally unique
-- across their platform, but that guarantee evaporates the moment a PMS with
-- only-per-account-unique ids is added. This closes the hole defensively.
--
-- The old global uniques are supersets-safe to replace: since (source,
-- external_conversation_id) is already globally unique, (org_id, source,
-- external_conversation_id) is trivially unique too, so the new index builds
-- without conflict (same for hostaway_message_id).
--
-- Constraint drops are done by column-signature lookup rather than by hardcoded
-- name so the migration is robust to auto-generated naming and idempotent.

begin;

-- 1. conversations: (source, external_conversation_id)
--                -> (org_id, source, external_conversation_id)
create unique index if not exists conversations_org_source_extid_uq
  on public.conversations (org_id, source, external_conversation_id);

do $$
declare target text;
begin
  select con.conname into target
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'conversations'
    and con.contype = 'u'
    and (
      select array_agg(att.attname::text order by att.attname::text)
      from unnest(con.conkey) as k(attnum)
      join pg_attribute att
        on att.attrelid = con.conrelid and att.attnum = k.attnum
    ) = array['external_conversation_id', 'source']::text[];
  if target is not null then
    execute format('alter table public.conversations drop constraint %I', target);
  end if;
end $$;

-- 2. guest_messages: (hostaway_message_id) -> (org_id, hostaway_message_id)
--    hostaway_message_id is nullable (Hospitable rows have none); nulls are
--    distinct so multiple null rows per org stay allowed.
create unique index if not exists guest_messages_org_hostaway_msg_uq
  on public.guest_messages (org_id, hostaway_message_id);

do $$
declare target text;
begin
  select con.conname into target
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'guest_messages'
    and con.contype = 'u'
    and (
      select array_agg(att.attname::text order by att.attname::text)
      from unnest(con.conkey) as k(attnum)
      join pg_attribute att
        on att.attrelid = con.conrelid and att.attnum = k.attnum
    ) = array['hostaway_message_id']::text[];
  if target is not null then
    execute format('alter table public.guest_messages drop constraint %I', target);
  end if;
end $$;

commit;
