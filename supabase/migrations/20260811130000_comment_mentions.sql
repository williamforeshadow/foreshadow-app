-- Comment @-mentions, phase 1 (backend).
--
-- Mentions are stored twice on purpose:
--   * inline in project_comments.comment_content as @[Name](user-uuid) tokens,
--     so the comment text stays a single self-contained plain-text column
--   * normalized into comment_mentions, so "who was mentioned" is queryable
--     (notifications, a future mentions-of-me view) without re-parsing text.
--
-- Also adds the 'task_mentioned' notification type (both CHECK constraints,
-- following 20260512143000 / 20260611140100), and re-creates the
-- search_embedding_queue view so mention tokens embed as "@Name" instead of
-- leaking raw uuids into the embedding text. The trigram index/search on
-- comment_content is deliberately left raw: the display name inside the token
-- still trigram-matches, and rewriting the indexed expression would force a
-- new index for marginal gain.

begin;

-- ---------------------------------------------------------------------------
-- 1. comment_mentions
-- ---------------------------------------------------------------------------

create table if not exists public.comment_mentions (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.project_comments(id) on delete cascade,
  mentioned_user_id text not null references public.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id),
  created_at timestamptz not null default now(),
  unique (comment_id, mentioned_user_id)
);

create index if not exists idx_comment_mentions_user
  on public.comment_mentions (mentioned_user_id, created_at desc);

alter table public.comment_mentions enable row level security;

drop policy if exists org_isolation on public.comment_mentions;
create policy org_isolation on public.comment_mentions
  for all to authenticated
  using (org_id in (select public.app_current_user_orgs()))
  with check (org_id in (select public.app_current_user_orgs()));

-- Belt-and-suspenders org stamping, matching 20260703040000: writers set
-- org_id explicitly, the trigger backfills from the parent comment if a
-- future writer forgets.
drop trigger if exists trg_derive_org_comment_mentions_comment_id on public.comment_mentions;
create trigger trg_derive_org_comment_mentions_comment_id
  before insert on public.comment_mentions
  for each row execute function public.derive_org_id('project_comments', 'comment_id');

-- ---------------------------------------------------------------------------
-- 2. task_mentioned notification type
-- ---------------------------------------------------------------------------

alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (
    type in (
      'task_created_assigned',
      'task_assigned',
      'task_unassigned',
      'task_commented',
      'task_mentioned',
      'task_schedule_changed',
      'task_status_changed',
      'task_due_today',
      'task_bin_changed',
      'task_attachment_added',
      'task_title_changed',
      'task_priority_changed',
      'task_description_changed',
      'proposed_task',
      'proposed_reply',
      'proposed_knowledge'
    )
  );

alter table public.notification_preferences
  drop constraint if exists notification_preferences_type_check;

alter table public.notification_preferences
  add constraint notification_preferences_type_check
  check (
    type in (
      'task_created_assigned',
      'task_assigned',
      'task_unassigned',
      'task_commented',
      'task_mentioned',
      'task_schedule_changed',
      'task_status_changed',
      'task_due_today',
      'task_bin_changed',
      'task_attachment_added',
      'task_title_changed',
      'task_priority_changed',
      'task_description_changed'
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Embedding queue: embed mentions as "@Name", not raw tokens
-- ---------------------------------------------------------------------------
-- Full re-create of the view from 20260804120000 with one change: the comment
-- branch runs comment_content through regexp_replace to collapse
-- @[Name](uuid) tokens to @Name. The eligibility length gate and the
-- search_content_hash generated column stay keyed on the RAW text — the hash
-- only detects staleness, and a token edit should re-embed anyway.

create or replace view public.search_embedding_queue
with (security_invoker = true) as
  select
    'task'::text                                   as source_type,
    t.id                                           as source_id,
    t.org_id                                       as org_id,
    t.search_content_hash                          as content_hash,
    coalesce(t.title, '') || E'\n' ||
      coalesce(t.description_text, '')             as content,
    coalesce(t.updated_at, t.created_at, 'epoch')  as source_changed_at
  from public.turnover_tasks t
  where length(btrim(coalesce(t.title, '') || ' ' || coalesce(t.description_text, ''))) >= 12

  union all

  select
    'comment'::text,
    c.id,
    c.org_id,
    c.search_content_hash,
    regexp_replace(
      c.comment_content,
      '@\[([^\]]+)\]\([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\)',
      '@\1',
      'g'
    ),
    coalesce(c.created_at, 'epoch')
  from public.project_comments c
  where c.task_id is not null
    and length(btrim(c.comment_content)) >= 20

  union all

  select
    'message'::text,
    m.id,
    m.org_id,
    m.search_content_hash,
    m.body,
    m.created_at
  from public.guest_messages m
  where m.conversation_id is not null
    and length(btrim(m.body)) >= 20;

comment on view public.search_embedding_queue is
  'Every unit of text eligible for embedding, with the hash of its current content. Anti-joined against search_embeddings to find what is stale. The length filters are eligibility rules, not a backlog — short units are intentionally never embedded. Comment @[Name](uuid) mention tokens are collapsed to @Name before embedding.';

commit;
