-- Task-proposal sensitivity: an org-level dial (1-5) controlling how eager the
-- concierge is to draft operational tasks from guest messages. Lives on the
-- operations_settings singleton (id=1) alongside check-in/out times + timezone.
--
-- 1 = critical only … 5 = track everything. Default 2 (clear operational work),
-- which matches the prior hardcoded behavior.

begin;

alter table public.operations_settings
  add column if not exists task_proposal_sensitivity smallint not null default 2
    check (task_proposal_sensitivity between 1 and 5);

commit;
