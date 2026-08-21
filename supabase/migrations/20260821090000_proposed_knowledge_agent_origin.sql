-- Proposed knowledge can now originate from the OPS AGENT (web chat), not just
-- the concierge — phase 3 of the proposal-card work, mirroring
-- 20260820120000_proposed_tasks_agent_origin for proposed_tasks. The agent
-- inserts a pending row via propose_property_knowledge; the chat renders the
-- same editable ProposedKnowledge bubble the inbox uses; the human click on
-- Save (optionally after inline edits) IS the confirmation, replayed through
-- the same accept route.

begin;

alter table public.proposed_knowledge
  alter column conversation_id drop not null;

alter table public.proposed_knowledge
  -- The web agent_sessions row the proposal was made in. Audit/scoping only —
  -- rehydration reads ids from the chat message metadata, not this column.
  add column if not exists agent_session_id uuid
    references public.agent_sessions(id) on delete set null,
  -- Uploaded photos to attach to the resulting resource on accept (attribute
  -- and room targets only; other kinds have no photo surface). Not rendered
  -- on the card for now — carried through and filed after the write.
  add column if not exists attachment_inbound_file_ids uuid[] not null default '{}';

-- A concierge row must still carry its conversation; only agent rows may be
-- conversation-less.
alter table public.proposed_knowledge
  add constraint proposed_knowledge_origin_link check (
    conversation_id is not null or source = 'agent'
  );

create index if not exists proposed_knowledge_agent_session_idx
  on public.proposed_knowledge (agent_session_id, status)
  where agent_session_id is not null;

commit;
