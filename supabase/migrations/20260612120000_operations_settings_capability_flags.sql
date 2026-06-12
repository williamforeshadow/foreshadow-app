-- Concierge capability master switches: three org-level booleans controlling
-- whether the concierge AUTONOMOUSLY proposes replies, tasks, and property
-- knowledge from incoming guest messages. Live on the operations_settings
-- singleton (id=1) alongside the task-proposal sensitivity dial.
--
-- "Autonomous" only: these gate the webhook eager-generation passes. Manual
-- triggers (the inbox "Regenerate" button, the ops-agent concierge tool) call
-- the persist functions directly and are unaffected.
--
-- Default true preserves today's behavior (all capabilities on).

begin;

alter table public.operations_settings
  add column if not exists reply_proposal_enabled boolean not null default true,
  add column if not exists task_proposal_enabled boolean not null default true,
  add column if not exists knowledge_proposal_enabled boolean not null default true;

commit;
