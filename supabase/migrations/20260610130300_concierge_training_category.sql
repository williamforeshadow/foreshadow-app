-- Concierge training rules now serve two distinct drafting paths: guest REPLY
-- drafting (the original behavior) and the new operational TASK drafting (the
-- triage pass). A `category` discriminator keeps the two rule sets separate so a
-- "reply" rule never bleeds into the task triage prompt and vice versa.
--
-- default 'reply' back-fills every existing rule into the reply path, preserving
-- current behavior exactly.

begin;

alter table public.concierge_training
  add column if not exists category text not null default 'reply'
    check (category in ('reply', 'task'));

create index if not exists concierge_training_category_idx
  on public.concierge_training (category, is_active);

commit;
