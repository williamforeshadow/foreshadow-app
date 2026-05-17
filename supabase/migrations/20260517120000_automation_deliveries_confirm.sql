-- Split delivery "claim" from delivery "confirmed".
--
-- automation_deliveries previously only had delivered_at, set at *claim*
-- time. If a worker crashed between claiming and the actual Slack post, the
-- row persisted forever and permanently blocked every future retry of that
-- (automation, signature, recipient) — the message was silently lost.
--
-- confirmed_at is set only after postToChannel succeeds. The runtime treats
-- a row with confirmed_at IS NULL and a stale delivered_at as an orphaned
-- claim it may take over. Additive + backfill so existing rows (which were
-- only ever written on success under the old code path) are treated as
-- confirmed and keep deduping.

begin;

alter table automation_deliveries
  add column if not exists confirmed_at timestamptz;

update automation_deliveries
  set confirmed_at = delivered_at
  where confirmed_at is null;

commit;
