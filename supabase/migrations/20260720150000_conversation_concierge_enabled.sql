-- Per-conversation concierge kill switch.
--
-- The concierge's autonomous proposals (reply, task, knowledge, sentiment) are
-- governed org-wide by operations_settings. But some individual guest threads
-- simply need a human — an AI draft there is a distraction or a liability. This
-- per-conversation flag lets an operator take manual control of one thread
-- without touching the org's settings.
--
-- Defaults true so every existing and future conversation keeps today's
-- behavior; the effective gate on each autonomous path becomes
--   (org master switch) AND conversations.concierge_enabled.
-- Turning it OFF also clears the pending proposed reply — the operator is taking
-- over, so a stale AI draft shouldn't linger under a human-run conversation.
-- That clear happens in the status route, not here.

alter table public.conversations
  add column if not exists concierge_enabled boolean not null default true;
