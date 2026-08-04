-- Semantic search, part 1 of 2: storage and freshness. Nothing reads this yet.
--
-- WHY THIS EXISTS
--
-- 20260731120000_task_trigram_search.sql chose trigram over full-text search and
-- recorded the measurements. It also recorded the boundary trigram cannot cross:
--
--     landscaping   "Get a gardener..."   0.08   no
--
-- No character-level technique connects "landscaping" to "gardener". Operators
-- searching years of notes cannot recall the exact words someone typed months
-- ago, and guests never use internal wording at all. That gap needs embeddings.
--
-- This migration builds the corpus and the machinery that keeps it fresh. The
-- read path (fusing a vector score into search_tasks/search_conversations) is a
-- separate migration, deliberately, so this one can be deployed and left to
-- converge for days before anything depends on it.
--
--
-- THE CENTRAL DESIGN PROBLEM: AN EMBEDDING IS A DERIVED COPY
--
-- If the source text changes and its vector does not, search silently returns
-- answers based on what a task USED to say. That failure is invisible: no error,
-- no empty result, just a quietly wrong answer months later.
--
-- The obvious fix -- have every write path update the vector -- is the one this
-- repo already rejected for description_text, in that migration's own words:
-- an app-maintained mirror "only has to be forgotten once". A migration script,
-- a bulk import, a manual dashboard edit, or a feature built years from now all
-- have to remember, forever.
--
-- So: DERIVE AND DETECT instead. Each source row carries a GENERATED content
-- hash that Postgres recomputes on every write. Each stored vector records the
-- hash it was computed FROM. Anything where those two disagree is stale, by
-- definition, and a sweep re-embeds it. No writer participates, so no writer can
-- forget. Restore a backup, replay a sync, change the recipe, lose a tick to a
-- deploy -- the next sweep converges regardless.
--
-- A consequence worth stating plainly: there is NO CURSOR anywhere in this
-- design. Embedding a unit removes it from the queue because its stored hash
-- then matches. That is what makes backfill and steady-state freshness the same
-- mechanism rather than two, and it is why the 60s Vercel route ceiling costs
-- nothing -- a tick that dies mid-batch just leaves those units queued.
--
--
-- WHY THE EXTENSION STATEMENT IS HERE
--
-- There is no `create extension` statement anywhere else in supabase/migrations.
-- vector, pg_trgm and pg_cron were all enabled out-of-band on the dev project,
-- so a fresh project provisioned from this repo would fail on the first
-- vector(1536). That is a latent bug in the trigram migrations too. Fixed here
-- for this extension at least.

create extension if not exists vector;

-- ---------------------------------------------------------------------------
-- 1. tiptap_to_text: the flattening, extracted so a hash can use it
-- ---------------------------------------------------------------------------
-- turnover_tasks.description_text already flattens the TipTap jsonb, but it is
-- GENERATED ALWAYS, and Postgres forbids one generated column referencing
-- another. So md5(title || description_text) is rejected outright and the
-- expression has to be reachable some other way.
--
-- Extracting it into an IMMUTABLE function is the cheap option. The alternative
-- -- redefining description_text to use this function -- means drop column +
-- add column, which is the ACCESS EXCLUSIVE table rewrite that migration
-- already warns about, for no behavioural gain.
--
-- THE COST, STATED HONESTLY: this expression now exists in two places. If they
-- ever diverge, the hash stops tracking what is actually embedded, and the
-- corpus silently stops going stale when it should. The exhaustive sweep will
-- NOT catch that, because the hash is self-consistent -- it just tracks the
-- wrong thing. This is the one genuine hole in the self-healing claim. Both
-- sites carry a cross-reference comment; keep them in step.
create or replace function public.tiptap_to_text(p_doc jsonb)
returns text
language sql
immutable
parallel safe
as $$
  -- Byte-identical to turnover_tasks.description_text's generation expression.
  -- `strict` matters: without it the ** accessor visits each node twice and
  -- every sentence lands duplicated.
  select translate(
    jsonb_path_query_array(p_doc, 'strict $.**.text')::text,
    '[]"',
    '   '
  )
$$;

comment on function public.tiptap_to_text(jsonb) is
  'Flattens TipTap/ProseMirror jsonb to plain text. MUST stay byte-identical to the generation expression of turnover_tasks.description_text — see 20260804120000_search_embeddings.sql for why the expression is duplicated.';

-- ---------------------------------------------------------------------------
-- 2. Content hashes on the source tables
-- ---------------------------------------------------------------------------
-- md5 here is a change detector, not a security primitive. Collision risk on
-- human-written prose is irrelevant. Do NOT "upgrade" it to sha256 -- every hash
-- would change and the entire corpus would re-embed for no benefit.
--
-- Note these are STORED generated columns, so adding them rewrites each table
-- under ACCESS EXCLUSIVE. Instant at current volume; a maintenance window for a
-- large tenant.
--
-- Changing WHAT TEXT goes into a hash (say, adding property_name) means drop +
-- add on these columns, after which every hash differs and the whole corpus
-- re-embeds. That is correct behaviour and it is expensive -- but it is also the
-- only way to make "we changed the embedding recipe" self-healing rather than a
-- one-off script somebody has to remember to run.

alter table public.turnover_tasks
  add column if not exists search_content_hash text
  generated always as (
    md5(coalesce(title, '') || E'\n' || coalesce(public.tiptap_to_text(description), ''))
  ) stored;

comment on column public.turnover_tasks.search_content_hash is
  'Read-only drift detector for semantic search. Compared against search_embeddings.content_hash to decide what needs re-embedding. Uses tiptap_to_text() because a generated column cannot reference description_text (also generated).';

alter table public.project_comments
  add column if not exists search_content_hash text
  generated always as (md5(coalesce(comment_content, ''))) stored;

comment on column public.project_comments.search_content_hash is
  'Read-only drift detector for semantic search. See search_embeddings.';

alter table public.guest_messages
  add column if not exists search_content_hash text
  generated always as (md5(coalesce(body, ''))) stored;

comment on column public.guest_messages.search_content_hash is
  'Read-only drift detector for semantic search. See search_embeddings.';

-- ---------------------------------------------------------------------------
-- 3. The corpus table
-- ---------------------------------------------------------------------------
-- POLYMORPHIC (source_type + source_id) rather than one nullable FK per source.
-- Three source types ship at once and search_properties / search_reservations
-- are obvious next targets; a typed-FK table needs DDL for each new source,
-- this one needs a new check value and a new branch in the queue view. The cost
-- is losing `on delete cascade`, handled by triggers in section 6.
--
-- chunk_index exists now even though nothing chunks. It costs one integer and it
-- means "split long descriptions into chunks" is later a DATA change instead of
-- a unique-key migration on a table that by then holds millions of rows. It is
-- the cheapest forward-compat lever here.
--
-- model is part of the unique key on purpose. A model swap then becomes a data
-- change: point the constant at a new model id, the sweep sees every unit as
-- missing FOR THAT MODEL and re-embeds through the same mechanism, and the read
-- path filters on model so vectors from different models are never compared to
-- each other (cosine distance across models is meaningless). Garbage-collect the
-- old rows afterwards.
--
-- embedding is NULLABLE on purpose. A null vector with attempts/last_error/
-- next_attempt_at set IS the failure record. That collapses what would otherwise
-- be a second table into the existing unique key, keeps one upsert path, and
-- keeps one place to look. Without it, a single permanently-poisoned unit sits
-- at the head of the queue and is retried every tick forever, starving
-- everything behind it. HNSW does not index nulls, so this costs nothing.
create table if not exists public.search_embeddings (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  source_type     text not null,
  source_id       uuid not null,
  chunk_index     integer not null default 0,
  model           text not null,
  content_hash    text not null,
  embedding       vector(1536),
  token_count     integer,
  attempts        smallint not null default 0,
  last_error      text,
  next_attempt_at timestamptz,
  embedded_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint search_embeddings_source_type_check
    check (source_type in ('task', 'comment', 'message'))
);

comment on table public.search_embeddings is
  'Vector corpus for semantic search. Never written by application write paths — maintained solely by the sweep in src/server/search/sweep.ts, which re-embeds anything whose source content_hash has drifted. See the migration header for why.';

-- A unique INDEX rather than a unique CONSTRAINT, so it can carry INCLUDE
-- (content_hash). That makes the sweep's anti-join index-only, which is the
-- hottest query in this design. ON CONFLICT works against a unique index.
create unique index if not exists search_embeddings_unit_key
  on public.search_embeddings (source_type, source_id, chunk_index, model)
  include (content_hash);

-- Two indexes, deliberately, because the right plan depends on tenant size.
--
-- HNSW serves the big-tenant case. At today's volume the planner will seq-scan
-- and never touch it -- that is correct, not a bug, and nobody should "fix" it.
--
-- The btree gives the planner a filter-then-exact-scan alternative. For a small
-- tenant inside a large multi-tenant table that plan is not merely acceptable,
-- it is BETTER: exact recall, no ANN approximation, no filtered-search recall
-- cliff. Having both is what makes the small-tenant case safe without
-- partitioning the table on day one.
--
-- `create index` and not `concurrently` because migrations run in a transaction
-- -- same caveat the trigram migration makes. At real scale the HNSW build wants
-- concurrently, outside a transaction, with maintenance_work_mem raised.
create index if not exists search_embeddings_hnsw
  on public.search_embeddings using hnsw (embedding vector_cosine_ops);

create index if not exists search_embeddings_org_model_type_idx
  on public.search_embeddings (org_id, model, source_type);

-- Retry queue: only failed rows have a next_attempt_at, so keep the index tiny.
create index if not exists search_embeddings_retry_idx
  on public.search_embeddings (next_attempt_at)
  where embedding is null;

-- ---------------------------------------------------------------------------
-- 4. org_id derivation
-- ---------------------------------------------------------------------------
-- The generic public.derive_org_id(parent, fk) trigger cannot be reused here:
-- it reads a fixed parent table out of TG_ARGV[0], and this table's parent
-- varies per row. Same early-return semantics as the generic one.
--
-- The sweep always sets org_id explicitly (it selects the source row anyway),
-- so this is a safety net for hand-written inserts, not the primary path.
create or replace function public.derive_search_embedding_org_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  derived uuid;
begin
  if NEW.org_id is not null then
    return NEW;
  end if;

  if NEW.source_type = 'task' then
    select org_id into derived from public.turnover_tasks where id = NEW.source_id;
  elsif NEW.source_type = 'comment' then
    select org_id into derived from public.project_comments where id = NEW.source_id;
  elsif NEW.source_type = 'message' then
    select org_id into derived from public.guest_messages where id = NEW.source_id;
  end if;

  if derived is not null then
    NEW.org_id := derived;
  end if;
  return NEW;
end$$;

drop trigger if exists trg_derive_org_search_embeddings on public.search_embeddings;
create trigger trg_derive_org_search_embeddings
  before insert on public.search_embeddings
  for each row execute function public.derive_search_embedding_org_id();

-- ---------------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------------
-- Same shape as every other org-scoped table (see 20260710120000).
alter table public.search_embeddings enable row level security;
drop policy if exists org_isolation on public.search_embeddings;
create policy org_isolation on public.search_embeddings
  for all to authenticated
  using (org_id in (select public.app_current_user_orgs()))
  with check (org_id in (select public.app_current_user_orgs()));

-- ---------------------------------------------------------------------------
-- 6. Garbage collection
-- ---------------------------------------------------------------------------
-- `on delete cascade` is not available on a polymorphic key, so delete the
-- vectors when their source dies. DB-level, not app-level, so it cannot be
-- forgotten once -- the same reasoning behind derive_org_id.
--
-- Worth knowing for triage: an orphan does NOT break correctness. The read path
-- joins the source table and drops rows that no longer exist. A GC lapse costs
-- index bloat, not wrong answers.
create or replace function public.gc_search_embeddings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.search_embeddings
   where source_type = TG_ARGV[0]
     and source_id = OLD.id;
  return OLD;
end$$;

drop trigger if exists trg_gc_search_embeddings_task on public.turnover_tasks;
create trigger trg_gc_search_embeddings_task
  after delete on public.turnover_tasks
  for each row execute function public.gc_search_embeddings('task');

drop trigger if exists trg_gc_search_embeddings_comment on public.project_comments;
create trigger trg_gc_search_embeddings_comment
  after delete on public.project_comments
  for each row execute function public.gc_search_embeddings('comment');

drop trigger if exists trg_gc_search_embeddings_message on public.guest_messages;
create trigger trg_gc_search_embeddings_message
  after delete on public.guest_messages
  for each row execute function public.gc_search_embeddings('message');

-- ---------------------------------------------------------------------------
-- 7. The queue
-- ---------------------------------------------------------------------------
-- One vector per UNIT OF TEXT: a task (title + description) is one unit, each
-- comment is its own, each guest message is its own. Not one blob per task --
-- that would dilute (a task with 30 comments produces a vector that means
-- nothing in particular) and it would destroy matched_in, which the agent uses
-- to decide whether it must open the task to read the note.
--
-- THE LENGTH GATES ARE ELIGIBILITY, NOT A SKIP-LIST. Comments here average 58
-- characters; "ok", "done", "thanks" are a real share of them. Embedding those
-- costs money and buys only nearest-neighbour noise that will happily clear any
-- similarity floor for an unrelated query. Because the gate lives in the view,
-- an ineligible unit is never "missing" -- it is simply not in the queue, so it
-- never shows up as permanent backlog.
--
-- Both directions of guest_messages are included: operators search for what the
-- guest said AND for what we told them.
--
-- security_invoker so a direct authenticated read is org-scoped by RLS. The
-- sweep reaches it through next_embedding_batch (security definer), which is
-- what lets one service-role pass see every org.
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
    c.comment_content,
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
  'Every unit of text eligible for embedding, with the hash of its current content. Anti-joined against search_embeddings to find what is stale. The length filters are eligibility rules, not a backlog — short units are intentionally never embedded.';

-- ---------------------------------------------------------------------------
-- 8. next_embedding_batch: what needs work right now
-- ---------------------------------------------------------------------------
-- Returns units that are missing, drifted, or failed-and-due. Three points
-- worth understanding before changing this:
--
-- FAIR SHARING. `cross join lateral organizations` with p_per_org stops one
-- tenant mid-backfill monopolising every tick and starving everyone else. The
-- LATERAL also lets Postgres stop after p_per_org rows PER ORG rather than
-- materialising the whole stale set and then windowing it.
--
-- NEWEST FIRST. On a cold backfill the most recently touched rows become
-- semantically searchable first, so the corpus is progressively useful from the
-- first tick instead of only at the end.
--
-- p_since IS A COST BOUND, NOT A SECOND MECHANISM. The predicate is identical;
-- only the time window differs. The frequent tick passes a recent window so
-- steady-state cost is O(churn); the hourly exhaustive tick passes null and
-- catches everything the window missed.
create or replace function public.next_embedding_batch(
  p_model   text,
  p_limit   integer     default 2000,
  p_per_org integer     default 400,
  p_since   timestamptz default null
)
returns table (
  source_type  text,
  source_id    uuid,
  org_id       uuid,
  content_hash text,
  content      text
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select b.source_type, b.source_id, b.org_id, b.content_hash, b.content
  from public.organizations o
  cross join lateral (
    select
      q.source_type,
      q.source_id,
      q.org_id,
      q.content_hash,
      -- text-embedding-3-small caps at 8191 tokens; 24k chars is comfortably
      -- inside that even for dense text.
      left(q.content, 24000) as content
    from public.search_embedding_queue q
    left join public.search_embeddings e
      on  e.source_type = q.source_type
      and e.source_id   = q.source_id
      and e.chunk_index = 0
      and e.model       = p_model
    where q.org_id = o.id
      and (p_since is null or q.source_changed_at >= p_since)
      and (
            e.id is null                                    -- never embedded
        or  e.content_hash is distinct from q.content_hash  -- content drifted
        or  (e.embedding is null                            -- failed, retry due
             and coalesce(e.next_attempt_at, now()) <= now())
      )
    order by q.source_changed_at desc
    limit p_per_org
  ) b
  limit p_limit;
$$;

comment on function public.next_embedding_batch(text, integer, integer, timestamptz) is
  'Units needing embedding for a given model: missing, drifted, or failed-and-due. There is no cursor — embedding a unit removes it from this result because its stored hash then matches. Fair-shared across orgs via LATERAL.';

-- ---------------------------------------------------------------------------
-- 9. upsert_search_embeddings: one round trip per batch
-- ---------------------------------------------------------------------------
-- Takes the whole batch as jsonb so a 96-unit batch is one statement, not 96.
--
-- The vector arrives as a JSON ARRAY STRING ("[0.013,-0.22,...]"). pgvector's
-- text input format is exactly JSON-array syntax, so ::vector is an unambiguous
-- cast and PostgREST never has to guess how to coerce an extension type.
--
-- A row with a null embedding and a non-null error bumps attempts and schedules
-- a backoff; a row with an embedding clears all the failure state. Backoff is
-- capped at 24h so a permanently-poisoned unit is retried daily rather than
-- every tick, without ever being permanently abandoned -- it self-heals the
-- moment its content changes, because then the hash differs and it is stale for
-- a different reason.
create or replace function public.upsert_search_embeddings(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  affected integer;
begin
  insert into public.search_embeddings as se (
    org_id, source_type, source_id, chunk_index, model,
    content_hash, embedding, token_count,
    attempts, last_error, next_attempt_at, embedded_at, updated_at
  )
  select
    (r->>'org_id')::uuid,
    r->>'source_type',
    (r->>'source_id')::uuid,
    0,
    r->>'model',
    r->>'content_hash',
    case when r->>'embedding' is null then null else (r->>'embedding')::vector(1536) end,
    nullif(r->>'token_count', '')::integer,
    case when r->>'error' is null then 0 else 1 end,
    r->>'error',
    case when r->>'error' is null then null else now() + interval '1 minute' end,
    case when r->>'embedding' is null then null else now() end,
    now()
  from jsonb_array_elements(p_rows) as r
  on conflict (source_type, source_id, chunk_index, model) do update
  set
    org_id          = excluded.org_id,
    content_hash    = excluded.content_hash,
    embedding       = coalesce(excluded.embedding, se.embedding),
    token_count     = coalesce(excluded.token_count, se.token_count),
    attempts        = case when excluded.embedding is not null then 0
                           else se.attempts + 1 end,
    last_error      = excluded.last_error,
    next_attempt_at = case
                        when excluded.embedding is not null then null
                        else now() + least(
                          power(2, least(se.attempts + 1, 11))::int * interval '1 minute',
                          interval '24 hours')
                      end,
    embedded_at     = case when excluded.embedding is not null then now()
                           else se.embedded_at end,
    updated_at      = now();

  get diagnostics affected = row_count;
  return affected;
end$$;

comment on function public.upsert_search_embeddings(jsonb) is
  'Batch writer for the embedding sweep. Rows carry the vector as a JSON array string. A null embedding with an error records a failure and schedules exponential backoff (capped at 24h) rather than creating a separate failure table.';

-- ---------------------------------------------------------------------------
-- 10. Grants
-- ---------------------------------------------------------------------------
-- The sweep runs as service_role. authenticated gets the read side only, so a
-- future in-app "why did this not match" view is possible without a new grant.
grant select on public.search_embedding_queue to authenticated, service_role;
grant execute on function public.tiptap_to_text(jsonb) to authenticated, service_role;
grant execute on function public.next_embedding_batch(text, integer, integer, timestamptz) to service_role;
grant execute on function public.upsert_search_embeddings(jsonb) to service_role;
