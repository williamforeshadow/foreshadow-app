-- Concierge training: worked examples per rule.
--
-- A training block used to be title + instructions only. Operators can now
-- attach real, worked example transcripts to a block so the model has a concrete
-- "here's it done right" to imitate. Examples are sourced two ways:
--   - promoted from a real guest conversation ("Turn into training"), where the
--     transcript is the faithful render of the selected messages, or
--   - hand-written/edited in the training editor.
--
-- A block holds many examples (one-to-many). Examples ride into the prompt with
-- their parent: always-tier examples in the cached system prefix, situational
-- examples on demand via get_concierge_procedure. Cascades with the parent rule.
--
-- Single-tenant for now: no org_id, matching concierge_training. A future
-- multi-tenant pass would add a nullable org_id + filter; nothing here blocks it.

create table if not exists public.concierge_training_examples (
  id                      uuid primary key default gen_random_uuid(),
  training_id             uuid not null references public.concierge_training(id) on delete cascade,
  -- Short human label for the example, e.g. "Guest asked for early check-in".
  label                   text,
  -- The example body. For promoted conversations this is the rendered transcript
  -- of the selected messages (faithful, not paraphrased by the model).
  transcript              text not null,
  -- Provenance: the conversation this example was promoted from, if any. Soft
  -- reference (no FK) so purging a conversation never cascades into training.
  source_conversation_id  uuid,
  sort_order              integer not null default 0,
  created_by_user_id      text,
  created_at              timestamptz not null default now()
);

create index if not exists concierge_training_examples_training_idx
  on public.concierge_training_examples (training_id);

alter table public.concierge_training_examples enable row level security;
