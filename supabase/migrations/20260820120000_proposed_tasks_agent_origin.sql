-- Proposed tasks can now originate from the OPS AGENT (web chat), not just the
-- concierge. The ops agent's task-creation flow moves off the token/Confirm
-- protocol onto the durable proposal model: the agent inserts a pending
-- proposed_tasks row, the chat panel renders it as the standard proposed-task
-- card, and the human click (accept, optionally after editing) IS the
-- confirmation — same lifecycle, same accept endpoint, no TTL.
--
-- Two shapes of change:
--   1. Origin: conversation_id becomes nullable (agent proposals have no guest
--      conversation) and agent proposals link to their chat session instead.
--      `source` distinguishes them: 'auto' = concierge triage, 'agent' = ops
--      agent. Every existing consumer queries by conversation_id, so concierge
--      surfaces never see agent rows and vice versa.
--   2. Field parity with the retired preview_task tool, so an agent proposal
--      can carry everything a staged create could: initial task status,
--      template tag, bin destination, and uploaded-file attachments.

begin;

alter table public.proposed_tasks
  alter column conversation_id drop not null;

alter table public.proposed_tasks
  -- The web agent_sessions row the proposal was made in. Audit/scoping only —
  -- rehydration reads ids from the chat message metadata, not this column.
  add column if not exists agent_session_id uuid
    references public.agent_sessions(id) on delete set null,
  -- Initial status for the created task ('contingent' for blocked work).
  -- Null = createTask's default ('not_started'). Named task_status because
  -- `status` is the proposal's own lifecycle.
  add column if not exists task_status text
    check (task_status in ('contingent','not_started','in_progress','paused','complete')),
  -- Template tag (does not apply automation config; mirrors preview_task).
  add column if not exists template_id uuid
    references public.templates(id) on delete set null,
  -- Bin destination, same vocabulary as preview_task: bin_id for a sub-bin,
  -- is_binned=true with no bin_id for the default Task Bin, both null/false
  -- for free-floating.
  add column if not exists bin_id uuid
    references public.project_bins(id) on delete set null,
  add column if not exists is_binned boolean,
  -- Uploaded files to attach after the task is created on accept.
  add column if not exists attachment_inbound_file_ids uuid[] not null default '{}';

-- A concierge row must still carry its conversation; only agent rows may be
-- conversation-less.
alter table public.proposed_tasks
  add constraint proposed_tasks_origin_link check (
    conversation_id is not null or source = 'agent'
  );

create index if not exists proposed_tasks_agent_session_idx
  on public.proposed_tasks (agent_session_id, status)
  where agent_session_id is not null;

commit;
