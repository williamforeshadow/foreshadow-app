-- Calendar blocks: manual/maintenance days a host blocked directly in Hostaway
-- that are NOT reservations. On the listing calendar these come through as
-- status 'blocked' (vs 'reserved' / 'available') with no reservation behind
-- them. Owner stays and guest bookings are reservations (status 'reserved' on
-- the calendar) and live in `reservations` — so they are NOT duplicated here.
--
-- Purpose: reflect true unavailability into the ops schedule. Blocks get NO
-- automations — the automation engine is reservation-only and never sees this
-- table.
--
-- Populated by the calendar sync (app/api/hostaway/calendar-sync), which derives
-- contiguous blocked-day runs per listing and replaces a property's
-- hostaway-sourced blocks within the refreshed forward window each run.
-- `source` distinguishes Hostaway-derived blocks from future in-app manual ones.

create table if not exists public.calendar_blocks (
  id uuid primary key default uuid_generate_v4(),
  property_id uuid not null references public.properties(id) on delete cascade,
  source text not null default 'hostaway',
  start_date date not null,
  end_date date not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_blocks_dates_check check (end_date >= start_date),
  constraint calendar_blocks_source_check check (source in ('hostaway', 'manual'))
);

create index if not exists calendar_blocks_property_idx
  on public.calendar_blocks (property_id);
create index if not exists calendar_blocks_window_idx
  on public.calendar_blocks (property_id, start_date, end_date);

-- Service-role-only: RLS on with no policies, so reads go through API routes
-- using the service-role key — the per-property schedule API and the
-- /api/calendar-blocks feed the multi-property Timeline uses. Never read via
-- the browser anon client.
alter table public.calendar_blocks enable row level security;
