-- Persisted guest-sentiment summary per conversation. An LLM reads the thread +
-- its reservation context and produces a coarse sentiment verdict plus a tight
-- 1-2 sentence summary of the most relevant matter. Like proposed_reply, it's
-- generated eagerly when a new message arrives and STORED on the conversation;
-- the reservation panel just reads it.
--
-- sentiment: 'positive' | 'neutral' | 'negative'
-- sentiment_answers_message_id: guest_messages.id of the latest sent message the
--   summary was written against — lets us skip regeneration when nothing's new.

alter table public.conversations
  add column if not exists sentiment                    text,
  add column if not exists sentiment_summary            text,
  add column if not exists sentiment_answers_message_id uuid,
  add column if not exists sentiment_generated_at       timestamptz;

-- Per-org master switch for autonomous sentiment generation, alongside the
-- reply/task/knowledge proposal flags. Default true preserves "on" behavior.
-- Gates only the autonomous (realtime ingest) path; degrades to enabled when
-- the column is missing in older environments.
alter table public.operations_settings
  add column if not exists sentiment_summary_enabled boolean not null default true;
