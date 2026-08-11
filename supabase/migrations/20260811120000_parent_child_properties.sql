-- Parent/child properties.
--
-- Some physical properties are sellable as a whole OR as parts: "Rosy Whole
-- House" (parent) encompasses "Rosy Back Studio" and "Rosy Front House"
-- (children). A booking on the parent means every child is physically
-- occupied by the same stay; a booking on a child means the parent as a
-- whole is no longer free. Sibling children remain independent of each other.
--
-- The relation is a single nullable self-FK, configured in Foreshadow's own
-- property settings (deliberately PMS-agnostic — no PMS grouping fields are
-- read). The hierarchy is exactly one level deep: a parent cannot itself
-- have a parent, and a property with children cannot become a child. That
-- keeps every "occupancy cohort" computable as self ∪ parent ∪ children
-- with no recursion anywhere in the app.
--
-- Reservations are NEVER copied across the relation. Occupancy readers
-- (occupancy snapshot, availability engine, timeline) union the cohort's
-- reservations at read time, so task automations — which key off actual
-- reservation rows — never fire for inherited occupancy by construction.

alter table properties
  add column if not exists parent_property_id uuid
    references properties(id) on delete set null;

comment on column properties.parent_property_id is
  'Optional parent unit this property is physically part of. One level deep: parents cannot have parents. Occupancy is inherited both directions at read time; reservations are never duplicated.';

create index if not exists properties_parent_property_id_idx
  on properties (parent_property_id)
  where parent_property_id is not null;

-- Enforce the one-level shape and same-org scoping at the database, so no
-- API path (or direct SQL) can create chains or cross-tenant links.
create or replace function enforce_property_parent_shape()
returns trigger
language plpgsql
as $$
declare
  parent_row properties%rowtype;
begin
  if new.parent_property_id is null then
    return new;
  end if;

  if new.parent_property_id = new.id then
    raise exception 'A property cannot be its own parent';
  end if;

  select * into parent_row from properties where id = new.parent_property_id;
  if not found then
    raise exception 'Parent property % does not exist', new.parent_property_id;
  end if;

  if parent_row.org_id is distinct from new.org_id then
    raise exception 'Parent property must belong to the same organization';
  end if;

  if parent_row.parent_property_id is not null then
    raise exception 'Parent property "%" is itself a child unit — hierarchies are one level deep', parent_row.name;
  end if;

  if exists (select 1 from properties where parent_property_id = new.id) then
    raise exception 'Property "%" has child units and cannot also have a parent', new.name;
  end if;

  return new;
end;
$$;

drop trigger if exists properties_enforce_parent_shape on properties;
create trigger properties_enforce_parent_shape
  before insert or update of parent_property_id on properties
  for each row
  execute function enforce_property_parent_shape();
