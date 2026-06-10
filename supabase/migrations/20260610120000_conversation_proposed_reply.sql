-- Persisted proposed reply per conversation. The Concierge drafts a reply and we
-- STORE it on the conversation (rather than regenerating on every inbox open).
-- It's generated eagerly when a new guest message arrives, or written by the ops
-- agent's `concierge` tool, and the inbox just reads it.
--
-- proposed_reply_answers_message_id is the guest_messages.id of the latest sent
-- message the draft was written against — used to tell when the draft is stale
-- (a newer guest message has arrived since).
-- proposed_reply_source: 'auto' (generated for the thread) | 'assistant' (drafted
-- via the ops agent, usually with an operator instruction).

alter table public.conversations
  add column if not exists proposed_reply                    text,
  add column if not exists proposed_reply_answers_message_id uuid,
  add column if not exists proposed_reply_source             text,
  add column if not exists proposed_reply_generated_at       timestamptz;
