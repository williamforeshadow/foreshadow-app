-- Lets a confirmed write continue into a dependent second step without the
-- operator having to re-prompt. The agent declares the remaining work during
-- the preview turn (declare_followup); the confirm handler replays it once the
-- commit succeeds. continuation_depth bounds the preview -> confirm -> preview
-- cycle so a misbehaving plan cannot loop forever.
alter table public.agent_pending_actions
  add column if not exists followup_instruction text,
  add column if not exists continuation_depth integer not null default 0;
