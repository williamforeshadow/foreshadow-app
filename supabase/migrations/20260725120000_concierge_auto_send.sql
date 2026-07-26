-- Concierge auto-send: the timer, and the record of what it did.
--
-- Until now the Concierge only ever DRAFTED. A human clicked Send. This adds an
-- optional timer: when an autonomous draft is written, arm a pending row here;
-- if nothing cancels it before due_at, a cron tick sends it.
--
-- ONE TABLE serves as both the queue and the audit log, deliberately:
--   - the `pending` row IS the armed timer (the cron polls for due ones)
--   - every terminal state stays as a row, so "what was scheduled, when, did it
--     fire, who cancelled it, why it was skipped" is answerable after the fact.
-- conversations.proposed_reply cannot do this job — it's a single column that is
-- overwritten in place on every regenerate, so it has no history at all.
--
-- draft_text is COPIED rather than referenced. What actually went to the guest
-- must survive the draft being regenerated or cleared, and it's the send
-- payload — resolving it late would risk sending text nobody reviewed.
--
-- OFF BY DEFAULT, and arming is FORWARD-ONLY. See operations_settings below.

create table if not exists public.concierge_auto_sends (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  conversation_id     uuid not null references public.conversations(id) on delete cascade,

  -- The exact text that was (or would have been) sent, snapshotted at arm time.
  draft_text          text not null,
  -- guest_messages.id the draft answers. Lets a tick re-verify that no newer
  -- guest message has landed since arming — the same staleness rule the inbox
  -- uses to decide a draft is no longer safe to show.
  answers_message_id  uuid,

  -- 'sending' is the claim state. A tick moves pending → sending with a
  -- conditional update before it calls the PMS, so two overlapping ticks can
  -- never both send the same row. A row stranded in 'sending' by a crashed
  -- process stays stranded on purpose: at-most-once is the safe failure
  -- direction when the alternative is messaging a guest twice.
  status              text not null default 'pending'
                        check (status in ('pending', 'sending', 'sent', 'cancelled', 'skipped', 'failed')),
  -- When the tick should fire it. Set at arm time from the org's configured delay.
  due_at              timestamptz not null,

  armed_at            timestamptz not null default now(),
  resolved_at         timestamptz,

  -- Why it ended up in a non-pending state: 'human_sent', 'new_guest_message',
  -- 'edited', 'concierge_disabled', 'conversation_inactive', 'stale_draft',
  -- 'auto_send_disabled', or a send failure code from sendGuestMessage.
  reason              text,
  -- Who cancelled, when a human did. Null for system cancels and for sends.
  -- text, not uuid — public.users.id is text in this schema.
  cancelled_by        text references public.users(id) on delete set null,
  -- guest_messages.id actually created, once sent.
  sent_message_id     text,

  created_at          timestamptz not null default now()
);

-- The queue index: the tick asks "which pending rows are due?".
create index if not exists concierge_auto_sends_due_idx
  on public.concierge_auto_sends (due_at)
  where status = 'pending';

-- At most ONE armed timer per conversation. Re-arming (a fresh draft) must
-- cancel the old row first, so a thread can never have two pending sends racing
-- to answer the same guest.
create unique index if not exists concierge_auto_sends_one_pending_idx
  on public.concierge_auto_sends (conversation_id)
  where status = 'pending';

-- Audit reads: "show me this thread's auto-send history", newest first.
create index if not exists concierge_auto_sends_conversation_idx
  on public.concierge_auto_sends (conversation_id, created_at desc);

-- Fill a NULL org_id from the parent conversation (the same generic trigger the
-- other child tables use), so a writer can never land a row in the wrong org by
-- omission.
drop trigger if exists trg_derive_org_concierge_auto_sends_conversation_id
  on public.concierge_auto_sends;
create trigger trg_derive_org_concierge_auto_sends_conversation_id
  before insert on public.concierge_auto_sends
  for each row execute function public.derive_org_id('conversations', 'conversation_id');

-- Per-org RLS (service role bypasses; user-scoped clients are isolated).
-- In practice only the arm path and the cron tick write here — both run on the
-- service client — but the policy is `for all` to match every other table rather
-- than inventing a read-only exception that a later writer would trip over.
alter table public.concierge_auto_sends enable row level security;
drop policy if exists org_isolation on public.concierge_auto_sends;
create policy org_isolation on public.concierge_auto_sends
  for all to authenticated
  using (org_id in (select public.app_current_user_orgs()))
  with check (org_id in (select public.app_current_user_orgs()));

comment on table public.concierge_auto_sends is
  'Auto-send timers and their outcomes. A pending row is an armed timer; terminal rows are the audit log.';

-- Which human-visible sends came from the Concierge rather than a person.
-- Nullable: every row that predates this column was a human send, but backfilling
-- it would assert something we did not actually record at the time.
alter table public.guest_messages
  add column if not exists sent_via text
    check (sent_via is null or sent_via in ('human', 'auto'));

comment on column public.guest_messages.sent_via is
  'human | auto — who sent an outbound message. Null for messages sent before auto-send existed.';

-- Org settings for the feature.
--
-- auto_send_enabled defaults FALSE. This inverts the convention used by the
-- other concierge flags (which read "enabled unless explicitly false", so a
-- missing column degrades to on). That convention is right for drafting, which
-- is harmless; it is exactly wrong for a switch that talks to guests unattended.
-- A missing/unreadable setting here must always mean OFF.
alter table public.operations_settings
  add column if not exists auto_send_enabled boolean not null default false,
  add column if not exists auto_send_delay_minutes integer not null default 10
    check (auto_send_delay_minutes >= 1 and auto_send_delay_minutes <= 1440),
  -- Set when auto_send_enabled flips false → true. Arming is FORWARD-ONLY: a
  -- draft generated before this instant never arms a timer. Without it, enabling
  -- the feature would arm every draft already sitting in the inbox and fire a
  -- burst of replies into threads that have been idle for days.
  add column if not exists auto_send_enabled_at timestamptz;

comment on column public.operations_settings.auto_send_enabled is
  'Master switch for unattended Concierge sends. Defaults FALSE — a missing or unreadable value must always read as off.';
comment on column public.operations_settings.auto_send_delay_minutes is
  'Minutes between a draft being written and it auto-sending. Minimum 1.';
comment on column public.operations_settings.auto_send_enabled_at is
  'When the switch was last turned on. Drafts generated before this never arm (forward-only).';
