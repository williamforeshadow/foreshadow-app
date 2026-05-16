-- Add per-automation property scoping to the new engine.
--
-- Empty array = applies to all properties (default).
-- Non-empty array = runtime only fires the automation for rows whose
-- property_id is in this set. This is surfaced as a first-class multi-select
-- in the editor, separate from conditions, so the common case ("only for
-- property 14") is one click rather than a hand-built condition rule.

begin;

alter table automations
  add column if not exists property_ids uuid[] not null default '{}';

-- GIN index — automations are filtered by overlap with the incoming row's
-- property_id; GIN keeps that O(log n) as the table grows.
create index if not exists automations_property_ids_idx
  on automations using gin (property_ids);

commit;
