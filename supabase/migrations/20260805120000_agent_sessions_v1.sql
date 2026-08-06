-- Agent sessions v1 — stop Slack and the web chat sharing one memory.
--
-- Until now `ai_chat_messages` was keyed on `user_id` alone, and BOTH surfaces
-- replayed the same last-30 rows (app/api/agent/route.ts + the loadHistory
-- helper in app/api/slack/events/route.ts). So a request started in Slack could
-- be finished in the web panel as if it were one conversation. This introduces
-- an explicit conversation container and points every message at one.
--
-- Keying, by surface:
--   web           — one session per user; Phase 2 lets them create/switch/name
--                   several. Resolved as "most recent non-archived" until then,
--                   which reproduces today's single continuous thread.
--   slack DM      — one session per (user, DM channel). Slack gives no way to
--                   start a second conversation in a DM, so this is fixed and
--                   never surfaces in the web session list.
--   slack channel — one session per THREAD (channel_id + thread_ts). Shared by
--                   everyone in that thread: the bot is participating in a team
--                   conversation, not holding N private ones.
--
-- Note the Slack thread reader (src/slack/thread.ts) is NOT redundant with
-- this. It drops bot-authored messages, so it supplies what the humans said and
-- this supplies what the agent itself said. They cover each other's blind spot.
--
-- Soft delete: `archived_at`. The per-message `metadata.tool_calls` trace is the
-- record used to diagnose hallucinated writes after the fact, so a session going
-- away must not take it with it.

begin;

create table if not exists public.agent_sessions (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  -- Web: the owner — the session list filters on this. Slack DM: the person on
  -- the other end. Slack channel thread: whoever mentioned the bot first, which
  -- is informational only (the thread key below is what identifies the session).
  owner_user_id     text references public.users(id) on delete cascade,
  surface           text not null check (surface in ('web', 'slack')),
  -- Null until Phase 2 auto-titles from the first user message.
  title             text,
  slack_channel_id  text,
  -- Null for DMs, which have no threads. Set for channel mentions.
  slack_thread_ts   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- Ordering key for the session list. Maintained by trigger on message insert
  -- rather than by hand, so no write path can forget it.
  last_message_at   timestamptz,
  archived_at       timestamptz,

  -- A Slack session is meaningless without the channel it lives in.
  constraint agent_sessions_slack_needs_channel
    check (surface <> 'slack' or slack_channel_id is not null)
);

-- One live session per Slack thread. Slack channel ids are globally unique, so
-- this needs no org component. Partial on archived_at so archiving a thread's
-- session lets a fresh one start; the coalesce collapses the DM case (null
-- thread_ts) into the same index.
create unique index if not exists agent_sessions_slack_key_idx
  on public.agent_sessions (slack_channel_id, coalesce(slack_thread_ts, ''))
  where surface = 'slack' and archived_at is null;

-- Drives the Phase 2 session list: a user's live web sessions, newest first.
create index if not exists agent_sessions_owner_idx
  on public.agent_sessions (owner_user_id, surface, last_message_at desc)
  where archived_at is null;

-- Fill a NULL org_id from the owner (same generic trigger the other user-owned
-- child tables use). Explicit org_id — which the app always sets — wins.
drop trigger if exists trg_derive_org_agent_sessions_owner_user_id
  on public.agent_sessions;
create trigger trg_derive_org_agent_sessions_owner_user_id
  before insert on public.agent_sessions
  for each row execute function public.derive_org_id('users', 'owner_user_id');

-- Per-org RLS, matching every other tenant table. NOTE: this is org-scoped, not
-- user-scoped, so it does NOT isolate one user's sessions from an org peer's.
-- Nothing reads this table with a user-scoped client today, and the Phase 2
-- session endpoints must stay on the service client with an explicit
-- owner_user_id filter for exactly that reason.
alter table public.agent_sessions enable row level security;
drop policy if exists org_isolation on public.agent_sessions;
create policy org_isolation on public.agent_sessions
  for all to authenticated
  using (org_id in (select public.app_current_user_orgs()))
  with check (org_id in (select public.app_current_user_orgs()));

-- ---- Message → session linkage ---------------------------------------------

alter table public.ai_chat_messages
  add column if not exists session_id uuid
    references public.agent_sessions(id) on delete cascade;

-- Promoted out of `metadata`. Slack rows already carried metadata.surface;
-- web rows carried nothing at all, so "which surface" was only inferable from
-- the ABSENCE of a tag. Left nullable: a write path we missed should log a bad
-- row, not 500 and cost the user their reply.
alter table public.ai_chat_messages
  add column if not exists surface text
    check (surface is null or surface in ('web', 'slack'));

-- The history read is now (session_id, created_at desc limit N).
create index if not exists ai_chat_messages_session_recent_idx
  on public.ai_chat_messages (session_id, created_at desc);

-- Keep last_message_at accurate without trusting every insert site to do it.
create or replace function public.touch_agent_session()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.session_id is not null then
    update public.agent_sessions
       set last_message_at = NEW.created_at,
           updated_at = now()
     where id = NEW.session_id;
  end if;
  return NEW;
end$$;

drop trigger if exists trg_touch_agent_session on public.ai_chat_messages;
create trigger trg_touch_agent_session
  after insert on public.ai_chat_messages
  for each row execute function public.touch_agent_session();

-- ---- Backfill ---------------------------------------------------------------
-- Small table (tens of rows), so this is a straight rewrite rather than a
-- batched job. Slack first (it self-identifies), then whatever is left is web.

-- One Slack session per (channel, thread_ts). org/owner come from the earliest
-- message in the group; last_message_at from the latest.
insert into public.agent_sessions (
  org_id, owner_user_id, surface, slack_channel_id, slack_thread_ts,
  created_at, updated_at, last_message_at
)
select
  (array_agg(m.org_id  order by m.created_at))[1],
  (array_agg(m.user_id order by m.created_at))[1],
  'slack',
  m.metadata->>'slack_channel',
  m.metadata->>'slack_thread_ts',
  min(m.created_at),
  max(m.created_at),
  max(m.created_at)
from public.ai_chat_messages m
where m.metadata->>'surface' = 'slack'
  and m.metadata->>'slack_channel' is not null
  and m.session_id is null
group by m.metadata->>'slack_channel', m.metadata->>'slack_thread_ts'
on conflict do nothing;

update public.ai_chat_messages m
   set session_id = s.id,
       surface = 'slack'
  from public.agent_sessions s
 where s.surface = 'slack'
   and m.session_id is null
   and m.metadata->>'surface' = 'slack'
   and m.metadata->>'slack_channel' = s.slack_channel_id
   and coalesce(m.metadata->>'slack_thread_ts', '') = coalesce(s.slack_thread_ts, '');

-- Everything still unlinked is web (web rows never carried a surface tag).
-- One session per user, reproducing the single continuous thread they had.
insert into public.agent_sessions (
  org_id, owner_user_id, surface, title,
  created_at, updated_at, last_message_at
)
select
  (array_agg(m.org_id order by m.created_at))[1],
  m.user_id,
  'web',
  'Chat',
  min(m.created_at),
  max(m.created_at),
  max(m.created_at)
from public.ai_chat_messages m
where m.session_id is null
group by m.user_id;

update public.ai_chat_messages m
   set session_id = s.id,
       surface = 'web'
  from public.agent_sessions s
 where s.surface = 'web'
   and m.session_id is null
   and m.user_id = s.owner_user_id;

commit;
