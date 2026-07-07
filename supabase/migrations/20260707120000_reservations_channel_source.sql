-- Preserve the finer booking sub-channel on reservations.
--
-- Hostaway collapses its long tail of small OTAs into channel = 'partner',
-- keeping the real origin (e.g. 'whimstay_00E532B430', or a direct-engine name)
-- in the reservation's `source` field. `reservations.channel` alone therefore
-- can't distinguish those. Capture `source` here so channel reporting and future
-- multi-PMS onboarding retain the true origin. Additive + nullable; no consumer
-- yet, populated going forward by the Hostaway/Hospitable syncs.

alter table public.reservations add column if not exists channel_source text;
