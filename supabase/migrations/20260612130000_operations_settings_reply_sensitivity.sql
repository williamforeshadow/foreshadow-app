-- Reply-proposal sensitivity: an org-level dial (1-4) controlling how readily the
-- concierge drafts a reply to an inbound guest message. Lives on the
-- operations_settings singleton (id=1) alongside the task-proposal dial + the
-- capability flags.
--
-- 1 = urgent only … 4 = every inbound message. Default 3 (reply to anything
-- substantive, skip pure acknowledgments). The gate is enforced inside the
-- autonomous draft path; manual "Regenerate" always drafts regardless.

begin;

alter table public.operations_settings
  add column if not exists reply_proposal_sensitivity smallint not null default 3
    check (reply_proposal_sensitivity between 1 and 4);

commit;
