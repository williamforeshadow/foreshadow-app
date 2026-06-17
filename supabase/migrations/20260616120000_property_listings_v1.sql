-- Property listings: per-OTA public listing URLs for each property, so the
-- guest-facing Concierge can recommend an alternative property with a hyperlink
-- to the listing ON THE SAME CHANNEL the guest is messaging from (an Airbnb
-- guest gets an Airbnb link, never a Vrbo/direct one — both a UX and an OTA
-- off-platform-steering-policy concern).
--
-- Unlike Property Knowledge (codes, wifi — locked-by-default, per-field
-- unlock), listing URLs are inherently PUBLIC, so this table is NOT part of the
-- visibility allowlist. It's service-role-only (RLS on, no policies) the same
-- way calendar_blocks is — reads go through API routes / agent tools using the
-- service-role key, never the browser anon client.
--
-- Populated two ways, distinguished by `source`:
--   - 'hostaway': backfilled by the listings sync from the Hostaway listing
--     object (airbnbListingUrl / vrboListingUrl / googleVrListingUrl).
--   - 'manual': entered in-app for channels Hostaway doesn't provide
--     (booking.com, direct, expedia). (Manual-entry UI is a later add; the
--     column + constraint exist now so the data model is stable.)

create table if not exists public.property_listings (
  id uuid primary key default uuid_generate_v4(),
  property_id uuid not null references public.properties(id) on delete cascade,
  channel text not null,
  url text not null,
  -- Optional friendly anchor text. Hostaway has no clean public title (its
  -- listing `name` is the operator's address-code), so the sync leaves this
  -- null; a future manual UI can set it. When null, callers describe the
  -- option by city/beds/baths and use a channel-appropriate link label.
  display_title text,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_listings_channel_check
    check (channel in ('airbnb', 'vrbo', 'bookingcom', 'expedia', 'direct', 'google_vr', 'other')),
  constraint property_listings_source_check check (source in ('hostaway', 'manual')),
  -- One URL per property per channel. The sync upserts on this key so a
  -- re-sync refreshes the URL rather than duplicating.
  constraint property_listings_property_channel_unique unique (property_id, channel)
);

create index if not exists property_listings_property_idx
  on public.property_listings (property_id);
create index if not exists property_listings_channel_idx
  on public.property_listings (property_id, channel);

alter table public.property_listings enable row level security;
