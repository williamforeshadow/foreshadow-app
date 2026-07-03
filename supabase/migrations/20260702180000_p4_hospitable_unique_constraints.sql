-- Multi-tenant P4: unique constraints for Hospitable record upserts.
-- (org_id, hospitable_*_id) — nulls are distinct, so org-1's null-valued
-- Hostaway rows don't collide. Replaces the partial indexes from the prior
-- migration (a unique constraint provides its own index).

begin;

drop index if exists public.idx_properties_hospitable_property_id;
drop index if exists public.idx_reservations_hospitable_reservation_id;

alter table public.properties
  add constraint properties_org_hospitable_uq unique (org_id, hospitable_property_id);
alter table public.reservations
  add constraint reservations_org_hospitable_uq unique (org_id, hospitable_reservation_id);

commit;
