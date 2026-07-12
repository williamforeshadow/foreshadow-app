-- Follow-up to 20260710120000_property_access_items: the fixed-column
-- property_access singleton was replaced by property_access_items and its data
-- backfilled. Nothing in the app reads or writes property_access anymore, so
-- drop it. (Apply only after the code that reads property_access_items is live.)

begin;

drop table if exists public.property_access;

commit;
