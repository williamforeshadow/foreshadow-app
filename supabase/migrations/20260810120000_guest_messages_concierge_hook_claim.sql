-- Record whether the Concierge generators ran for a message, instead of
-- inferring it from who won the insert.
--
-- The webhook runs three generators per inbound message (reply draft, task
-- triage, knowledge triage). To stop Hostaway retries running them twice, the
-- webhook used its own upsert as the signal: ON CONFLICT DO NOTHING returns no
-- row, so "no row back" was read as "this is a redelivery, I already handled
-- it."
--
-- That inference held only while the webhook was the sole writer of
-- guest_messages. The every-minute outbound poll (migration
-- 20260726140000) broke it: the poll ingests threads with realtime side
-- effects OFF, so it creates message rows WITHOUT running any generator.
-- Hostaway's webhook lands a median of 23s after the guest hits send, which
-- leaves the poll a large slice of every minute in which to get there first.
-- When it does, the webhook finds a row it did not insert, concludes it already
-- ran, and returns — and nothing ever triages that message. Silent: no error,
-- no proposal, and a skip that looks exactly like the Concierge declining.
--
-- So make the thing we actually care about explicit. This column means "the
-- generators have been claimed for this message", and is set by an atomic
-- conditional update (set ... where ai_hooks_claimed_at is null), which is the
-- same guarantee against concurrent runs that the insert accidentally provided,
-- but keyed on the right question. Whoever claims it runs them; everyone else
-- skips; a second writer creating the row changes nothing.
--
-- Existing rows are backfilled to now(): every message already in the table has
-- had its chance at the generators, and leaving them NULL would let any later
-- re-delivery of an old message trigger a fresh round of proposals.

alter table public.guest_messages
  add column if not exists ai_hooks_claimed_at timestamptz;

update public.guest_messages
  set ai_hooks_claimed_at = created_at
  where ai_hooks_claimed_at is null;

comment on column public.guest_messages.ai_hooks_claimed_at is
  'When the Concierge generators (reply / task / knowledge) were claimed for this message. Claimed via an atomic conditional update so exactly one caller runs them, no matter which writer created the row. NULL means no one has run them yet.';
