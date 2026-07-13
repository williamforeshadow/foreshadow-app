-- Add guest contact + party-size fields to reservations, populated by the
-- per-PMS sync routes (Hostaway/Hospitable). Nullable + additive so existing
-- rows are unaffected and backfill as each reservation next syncs. Surfaced on
-- the messages reservation panel; check-in/out TIME stays org-wide
-- (operations_settings.default_check_in_time) — not per-reservation.
alter table public.reservations
  add column if not exists guest_email text,
  add column if not exists guest_phone text,
  add column if not exists guest_count integer;
