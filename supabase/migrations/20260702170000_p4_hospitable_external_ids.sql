-- Multi-tenant P4 (foundation): Hospitable external-id columns.
--
-- Hospitable keys records by UUID (text), unlike Hostaway's integer ids. Add
-- provider-specific columns alongside the existing hostaway_* ones so the
-- Hospitable sync can map its records without disturbing the Hostaway path.
-- (guest_messages generalization comes with the Hospitable message-ingest step.)

begin;

alter table public.properties
  add column if not exists hospitable_property_id text;
alter table public.reservations
  add column if not exists hospitable_reservation_id text;

-- Org-scoped lookups (a future unique would be (org_id, hospitable_*_id)).
create index if not exists idx_properties_hospitable_property_id
  on public.properties (org_id, hospitable_property_id)
  where hospitable_property_id is not null;
create index if not exists idx_reservations_hospitable_reservation_id
  on public.reservations (org_id, hospitable_reservation_id)
  where hospitable_reservation_id is not null;

commit;
