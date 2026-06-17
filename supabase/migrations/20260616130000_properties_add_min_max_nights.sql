-- Minimum / maximum nights per stay, backfilled from the PMS listing (e.g.
-- Hostaway minNights/maxNights via the listings sync). Used to gate availability:
-- a stay shorter than min_nights (or longer than max_nights) is not bookable
-- even when the calendar is open, so the availability tools filter on these.
--
-- Nullable: unknown until the sync populates them; null means "no rule known".

alter table public.properties
  add column if not exists min_nights integer,
  add column if not exists max_nights integer;

comment on column public.properties.min_nights is 'Minimum nights per stay (backfilled from the PMS listing, e.g. Hostaway minNights). Used to gate availability recommendations.';
comment on column public.properties.max_nights is 'Maximum nights per stay (backfilled from the PMS listing, e.g. Hostaway maxNights).';
