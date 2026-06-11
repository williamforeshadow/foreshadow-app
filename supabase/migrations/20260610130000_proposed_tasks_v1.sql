-- Proposed Tasks v1 — the concierge drafts an operational task UNPROMPTED when
-- an inbound guest message implies work (e.g. "the AC is broken"). The draft is
-- persisted here as a durable, reviewable record and surfaced as a "proposed
-- task" bubble in the conversation thread. Accepting it (a human click) calls
-- the same createTaskService commit path the agent uses — the click IS the
-- confirmation, so no token protocol is needed. Mirrors the proposed_reply
-- pattern (columns on conversations), but tasks are rich enough to warrant a
-- dedicated table with an accept/dismiss lifecycle.

begin;

create table if not exists public.proposed_tasks (
  id                     uuid primary key default gen_random_uuid(),
  conversation_id        uuid not null references public.conversations(id) on delete cascade,
  -- The inbound message that triggered the draft. Used for dedup (one pending
  -- proposal per message) and to anchor the bubble in the thread.
  triggering_message_id  uuid references public.guest_messages(id) on delete set null,
  property_id            uuid references public.properties(id) on delete set null,
  -- Draft fields — the writable subset of a task. Description is plain text;
  -- createTaskService synthesizes the Tiptap doc on accept.
  title                  text not null,
  description            text,
  priority               text not null default 'medium'
                           check (priority in ('urgent', 'high', 'medium', 'low')),
  department_id          uuid references public.departments(id) on delete set null,
  suggested_assignee_ids uuid[] not null default '{}',
  -- Lifecycle
  status                 text not null default 'pending'
                           check (status in ('pending', 'accepted', 'dismissed')),
  resulting_task_id      uuid references public.turnover_tasks(id) on delete set null,
  decided_by             text references public.users(id) on delete set null,
  decided_at             timestamptz,
  source                 text not null default 'auto',
  -- The triage model's rationale, kept for audit/tuning.
  reasoning              text,
  generated_at           timestamptz not null default now(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- At most one PENDING proposal per triggering message. The generation gate also
-- checks for any pending proposal on the conversation before drafting, so
-- follow-up messages are skipped in code; this index is the race safety net.
create unique index if not exists proposed_tasks_pending_per_message
  on public.proposed_tasks (triggering_message_id)
  where status = 'pending';

create index if not exists proposed_tasks_conversation_idx
  on public.proposed_tasks (conversation_id, status);

alter table public.proposed_tasks enable row level security;
-- Intentionally NO policies: all access is service-role through API routes
-- (mirrors guest_messages / conversations / concierge_training).

commit;
