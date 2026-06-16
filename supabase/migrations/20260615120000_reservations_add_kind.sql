-- Owner stays now flow into `reservations`, distinguished by `kind`.
--
-- Owner stays arrive through the same Hostaway reservations feed (status
-- 'ownerStay') that we already poll — we simply stopped filtering them out.
-- They're tagged `kind = 'owner_stay'` so every consumer can tell them apart,
-- while still inheriting the existing reservation automations by default
-- (a future pass can gate automations on `kind` per the operator's preference).
--
-- Default 'guest_booking' means every existing row — and every other insert
-- path (Hostaway guest bookings, manual UI reservations) — is unchanged with
-- zero backfill. Manual/maintenance calendar blocks are NOT reservations and
-- will live in a separate `calendar_blocks` table (Phase 2).

alter table public.reservations
  add column if not exists kind text not null default 'guest_booking';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reservations_kind_check'
  ) then
    alter table public.reservations
      add constraint reservations_kind_check
      check (kind in ('guest_booking', 'owner_stay'));
  end if;
end $$;

create index if not exists reservations_kind_idx on public.reservations (kind);
