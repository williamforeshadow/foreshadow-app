-- The reply-warrant sensitivity gate's DECISION, persisted.
--
-- proposed_reply_answers_message_id records "a draft exists for this message".
-- There was no counterpart for "the gate looked at this message and decided no
-- reply was warranted" — that path stored nothing, so a declined message was
-- indistinguishable from one that had never been drafted at all. The inbox read
-- that null as "not generated yet" and re-ran the Concierge on open, silently
-- un-making the gate's decision (and burning a model call every time).
--
-- Deliberately a SEPARATE column rather than nulling proposed_reply: a decline
-- must not destroy a still-useful draft written against an EARLIER message. A
-- guest's "thanks!" doesn't warrant a reply of its own, but it also doesn't
-- answer the question they asked before it — that draft stays, marked stale.

alter table public.conversations
  add column if not exists proposed_reply_declined_message_id uuid;
