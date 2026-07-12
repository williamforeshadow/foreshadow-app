-- Configurable Access: replace the fixed-column property_access singleton with a
-- collection of access items (property_access_items). The operator adds only the
-- items that apply from a curated type set (+ "other"); each item is a value with
-- an optional note. Visibility becomes a per-item collection (like rooms/contacts).
--
-- This migration: creates the table (org_id derive + RLS mirroring property_contacts),
-- backfills existing property_access rows into items, and RESETS the old Access
-- guest-visibility rows (they keyed by bare column name, which no longer exists).
-- property_access is intentionally KEPT for rollback safety (dropped in a follow-up).

begin;

create table if not exists public.property_access_items (
  id                  uuid primary key default gen_random_uuid(),
  property_id         uuid not null references public.properties(id) on delete cascade,
  -- Curated type key (entry_code, gate_code, parking_type, …, or 'other').
  type                text not null default 'other',
  label               text not null,
  value               text,
  notes               text,
  sort_order          integer not null default 0,
  org_id              uuid not null references public.organizations(id) on delete cascade,
  created_by_user_id  text,
  updated_by_user_id  text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists property_access_items_property_idx
  on public.property_access_items (property_id, sort_order);

-- Fill a NULL org_id from the parent property (same generic trigger the other
-- child tables use). Explicit org_id (set by the backfill below) wins.
drop trigger if exists trg_derive_org_property_access_items_property_id
  on public.property_access_items;
create trigger trg_derive_org_property_access_items_property_id
  before insert on public.property_access_items
  for each row execute function public.derive_org_id('properties', 'property_id');

-- Per-org RLS (service role bypasses; user-scoped clients are isolated).
alter table public.property_access_items enable row level security;
drop policy if exists org_isolation on public.property_access_items;
create policy org_isolation on public.property_access_items
  for all to authenticated
  using (org_id in (select public.app_current_user_orgs()))
  with check (org_id in (select public.app_current_user_orgs()));

-- ---- Backfill: one item per non-null column of each property_access row -------
-- Code-like columns → value; free-text columns → notes.
insert into public.property_access_items (property_id, org_id, type, label, value, notes, sort_order)
select property_id, org_id, 'entry_code', 'Entry code (guest)', guest_code, code_rotation_notes, 0
from public.property_access where guest_code is not null;

-- Preserve a lone code_rotation_notes (no guest_code to attach it to).
insert into public.property_access_items (property_id, org_id, type, label, value, notes, sort_order)
select property_id, org_id, 'other', 'Code rotation', null, code_rotation_notes, 12
from public.property_access where code_rotation_notes is not null and guest_code is null;

insert into public.property_access_items (property_id, org_id, type, label, value, notes, sort_order)
select property_id, org_id, 'team_code', 'Team / cleaner code', cleaner_code, null, 1
from public.property_access where cleaner_code is not null;

insert into public.property_access_items (property_id, org_id, type, label, value, notes, sort_order)
select property_id, org_id, 'backup_code', 'Backup code', backup_code, null, 2
from public.property_access where backup_code is not null;

insert into public.property_access_items (property_id, org_id, type, label, value, notes, sort_order)
select property_id, org_id, 'entry_code', 'Unit door code', unit_door_code, null, 3
from public.property_access where unit_door_code is not null;

insert into public.property_access_items (property_id, org_id, type, label, value, notes, sort_order)
select property_id, org_id, 'building_code', 'Building / exterior door code', outer_door_code, null, 4
from public.property_access where outer_door_code is not null;

insert into public.property_access_items (property_id, org_id, type, label, value, notes, sort_order)
select property_id, org_id, 'gate_code', 'Gate code', gate_code, null, 5
from public.property_access where gate_code is not null;

insert into public.property_access_items (property_id, org_id, type, label, value, notes, sort_order)
select property_id, org_id, 'elevator', 'Elevator', null, elevator_notes, 6
from public.property_access where elevator_notes is not null;

insert into public.property_access_items (property_id, org_id, type, label, value, notes, sort_order)
select property_id, org_id, 'lockbox_code', 'Lockbox code', lockbox_code, null, 7
from public.property_access where lockbox_code is not null;

insert into public.property_access_items (property_id, org_id, type, label, value, notes, sort_order)
select property_id, org_id, 'key_location', 'Key location', key_location, null, 8
from public.property_access where key_location is not null;

insert into public.property_access_items (property_id, org_id, type, label, value, notes, sort_order)
select property_id, org_id, 'parking_spot', 'Parking spot number', parking_spot_number, null, 9
from public.property_access where parking_spot_number is not null;

insert into public.property_access_items (property_id, org_id, type, label, value, notes, sort_order)
select property_id, org_id, 'parking_type', 'Parking type', parking_type, null, 10
from public.property_access where parking_type is not null;

insert into public.property_access_items (property_id, org_id, type, label, value, notes, sort_order)
select property_id, org_id, 'parking_location', 'Parking location / instructions', null, parking_instructions, 11
from public.property_access where parking_instructions is not null;

-- ---- Reset Access guest-visibility (old rows keyed by bare column name) -------
delete from public.property_knowledge_visibility where resource_type = 'access_field';

commit;
