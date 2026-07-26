-- Change-detection markers for the outbound poll.
--
-- Hostaway has no webhook for host-sent messages — `message.received` fires for
-- inbound only. So a reply typed in the Hostaway dashboard, or a Hostaway
-- automation firing, reached us only via the 30-minute backfill: up to half an
-- hour of the inbox showing a thread as unanswered when it wasn't.
--
-- GET /v1/conversations solves this cheaply: every conversation carries
-- `messageSentOn` (last host message) and `messageReceivedOn` (last guest
-- message), and the list is returned sorted by messageSentOn DESC. One 100 KB
-- call is therefore a complete outbound change-signal for the whole account —
-- no per-thread request needed to find out which threads moved.
--
-- These two columns mirror those PMS-side timestamps so a poll can diff them.
-- They are deliberately SEPARATE from last_message_at, which is derived from our
-- own guest_messages rows and excludes future-dated (scheduled) automations.
-- Mixing the two would be a correctness bug in both directions: last_message_at
-- is a max across directions, so seeding external_last_sent_at from it would set
-- the sent marker too HIGH on any thread whose latest message is inbound, and a
-- subsequent host reply with an earlier timestamp would then read as "no change"
-- and never sync.
--
-- Both start NULL on purpose. The first poll tick seeds them from live data
-- WITHOUT re-ingesting (see pollOutbound.ts) — otherwise every thread in the
-- scan window would look changed at once and the first tick after deploy would
-- stampede the API. One tick of seeding, then real diffing forever after.

alter table public.conversations
  add column if not exists external_last_sent_at timestamptz,
  add column if not exists external_last_received_at timestamptz;

comment on column public.conversations.external_last_sent_at is
  'Mirror of the PMS conversation''s last host-message time (Hostaway messageSentOn). Change-detection only — not a substitute for last_message_at.';
comment on column public.conversations.external_last_received_at is
  'Mirror of the PMS conversation''s last guest-message time (Hostaway messageReceivedOn). Change-detection only.';
