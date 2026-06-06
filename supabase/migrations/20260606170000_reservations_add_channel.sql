begin;

-- Booking channel (Hostaway channelName, e.g. airbnbOfficial, bookingcom,
-- partner, direct). Surfaced in the conversation reservation panel. Nullable;
-- populated on sync + a one-time backfill.
alter table public.reservations
  add column if not exists channel text;

commit;
