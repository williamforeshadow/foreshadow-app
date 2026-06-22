-- Concierge training: tier rules into always-on vs situational.
--
-- The guest-reply draft used to inject EVERY active reply rule into every
-- message. That doesn't scale and dilutes the model's attention. We split rules:
--   - 'always'      → guardrails + safety/emergency procedures. Pinned into the
--                     (cached) system prefix on every draft.
--   - 'situational' → topic-specific playbooks (door lock, BabyQuip, etc.). Only
--                     their titles are listed in an index; the full body is
--                     loaded on demand via the get_concierge_procedure tool when
--                     the guest's message matches.
--
-- Default 'always' preserves behavior for every existing/other rule and for any
-- future rule created before the operator-facing toggle ships (no silent miss).
-- The operator UI toggle is a later enhancement; for now the 5 known procedure
-- rules are classified here by id.

alter table public.concierge_training
  add column if not exists tier text not null default 'always'
    check (tier in ('always', 'situational'));

create index if not exists concierge_training_tier_idx
  on public.concierge_training (category, tier, is_active);

-- Classify the existing situational procedures (by id — exact, re-runnable).
-- Door Lock, Children's Travel Amenity, Guest Recommendations,
-- Maintenance & Property Issues, Early/Late Check-in-out.
update public.concierge_training
set tier = 'situational'
where id in (
  '9ea08524-145d-4270-b414-c84de95962a2',
  '0f9f1b15-5775-43ff-9e7e-e28b70ed0a78',
  'b8aded56-688c-4963-96ca-6bb94c5433b6',
  'cd0d09a3-3982-4df0-8c5e-3a6ed5e0a4e9',
  '01781dd0-7752-4933-bed6-9b2fa70857f5'
);
