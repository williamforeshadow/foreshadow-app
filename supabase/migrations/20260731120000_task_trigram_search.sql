-- Ranked task search: trigram matching + recency decay.
--
-- Replaces the ilike fan-out in src/agent/tools/findTasks.ts, which had two
-- problems that only show up with real data volume:
--
--   1. No score. Every match was equally a match, so the row cap kept whichever
--      rows the scan reached first rather than the best ones. At 500 tasks the
--      set fits on one page and nobody notices; at 100k the right answer sits
--      below an arbitrary cutoff and nothing reports that it happened.
--   2. No forgiveness. Substring matching misses typos entirely ("dishwaser"
--      never finds "dishwasher") and misses word variants ("cleaning" never
--      finds "cleaned").
--
-- Trigram matching was chosen over Postgres full-text search deliberately.
-- FTS is the textbook answer and it is the wrong one here: it matches whole
-- tokens, so it would have BROKEN "yard" -> "backyard door", which is exactly
-- the casual phrasing this product needs to tolerate. Measured on real rows:
--
--   query        target                      trigram   FTS   ilike
--   yard         "...backyard door"          0.60      no    yes
--   dishwaser    "Fix the dishwasher..."     0.70      no    no
--   cleaning     "Deep cleaned the unit"     0.56      yes   no
--   aqua vista   "...Aqua Vista #508..."     1.00      yes   yes
--   landscaping  "Get a gardener..."         0.08      no    no
--
-- Trigram is the only one of the three that survives a typo, and it is the
-- only one that returns a SCORE, which is the whole point. The last row is the
-- honest boundary of every lexical approach: no amount of character matching
-- connects "landscaping" to "gardener". That gap needs embeddings, and pgvector
-- is already installed here when we want it.
--
-- Choosing trigram also deleted most of the machinery an FTS design needs:
-- no tsvector columns, no A/B/C field weights, no stemming configuration, and
-- no rank-normalization tuning (word_similarity compares the query against the
-- best-matching phrase, so a long note cannot win by repeating a word).

-- ---------------------------------------------------------------------------
-- 1. Plain-text mirror of the description
-- ---------------------------------------------------------------------------
-- turnover_tasks.description is TipTap/ProseMirror jsonb, not text, so no text
-- operator can reach inside it. This flattens every text node to a plain string
-- so it becomes searchable.
--
-- GENERATED ... STORED rather than app-maintained on purpose: Postgres
-- recomputes it on every insert and update, so it cannot drift. Any path that
-- ever writes a description -- the app today, a script, a manual fix, a feature
-- built years from now -- keeps search correct for free. An app-maintained
-- mirror only has to be forgotten once, and a silently stale search index is
-- the kind of bug that surfaces as a customer complaint months later.
--
-- The `strict` keyword matters: without it the jsonpath `**` accessor visits
-- each node twice and every sentence lands in the column duplicated.
--
-- translate() strips the JSON array punctuation (["..."]) down to spaces so the
-- stored value reads as prose rather than as a serialized array.
--
-- NOTE for future scale: adding a STORED generated column rewrites the table
-- and takes an ACCESS EXCLUSIVE lock. Instantaneous at today's 566 rows; on a
-- large tenant this would need a maintenance window or a nullable plain column
-- backfilled in batches instead.
alter table turnover_tasks
  add column if not exists description_text text
  generated always as (
    translate(
      jsonb_path_query_array(description, 'strict $.**.text')::text,
      '[]"',
      '   '
    )
  ) stored;

comment on column turnover_tasks.description_text is
  'Read-only. Auto-derived plain-text flattening of the TipTap description, maintained by Postgres for trigram search. Never write to this column; write to description.';

-- ---------------------------------------------------------------------------
-- 2. Trigram indexes
-- ---------------------------------------------------------------------------
-- These accelerate the `<%` word-similarity operator used by search_tasks(),
-- and they also transparently speed up the plain ILIKE queries already running
-- elsewhere in the codebase -- no caller has to change to benefit.
--
-- Plain CREATE INDEX (not CONCURRENTLY) because migrations run in a
-- transaction and these tables are small. Revisit for large tenants.
create index if not exists idx_turnover_tasks_title_trgm
  on turnover_tasks using gin (title gin_trgm_ops);

create index if not exists idx_turnover_tasks_description_text_trgm
  on turnover_tasks using gin (description_text gin_trgm_ops);

create index if not exists idx_turnover_tasks_property_name_trgm
  on turnover_tasks using gin (property_name gin_trgm_ops);

create index if not exists idx_project_comments_content_trgm
  on project_comments using gin (comment_content gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 3. The ranked search function
-- ---------------------------------------------------------------------------
-- Lives in the database rather than in TypeScript because PostgREST can express
-- "rows where X matches" but has no syntax for "ordered by how well they
-- matched". Ranking has to happen here.
--
-- This is also the seam that keeps the agent stable as retrieval improves: the
-- tool contract is find_tasks(search) -> ranked task_ids. When embeddings land,
-- the vector score gets fused into this function's ORDER BY and nothing above
-- it changes -- not the tool, not the system prompt, not the agent.
--
-- SECURITY INVOKER (the default, stated explicitly): callers pass their own
-- RLS-governed client, so row-level policies still apply inside the function.
-- p_org is defense-in-depth on top of that, matching how every tool already
-- filters.
create or replace function public.search_tasks(
  p_org uuid,
  p_query text,
  p_limit integer default 50,
  p_apply_recency boolean default true,
  -- Minimum trigram similarity for a field to count as a match, applied to the
  -- RAW score before recency decay.
  --
  -- Tuned against real data, not picked by feel. Measured word_similarity:
  --   trash -> trash          1.00   keep
  --   trash -> trashcan       0.83   keep
  --   dishwaser -> dishwasher 0.70   keep (the typo case)
  --   yard -> backyard        0.60   keep (the casual-phrasing case)
  --   trash -> track          0.50   REJECT (shares only the "tra" trigram)
  --
  -- So the usable band is (0.50, 0.60]. 0.55 sits in it. The first cut at 0.30
  -- returned 25 tasks for "trash", of which roughly two thirds were junk on
  -- exactly the trash/track pattern; 0.55 returns 8, all genuine. Going to 0.65
  -- would break "yard" -> "backyard", which is the phrasing tolerance this
  -- whole design was chosen for.
  p_threshold real default 0.55,
  p_half_life_days real default 180
)
returns table (task_id uuid, score real, matched_in text)
language plpgsql
stable
security invoker
set search_path = public, pg_catalog
as $$
begin
  -- The `<%` operator tests against a session GUC, not a literal, so set it
  -- locally (third arg true = this transaction only) to honour p_threshold.
  -- Using the operator rather than a bare word_similarity() >= comparison is
  -- what lets the GIN indexes above actually get used.
  perform set_config('pg_trgm.word_similarity_threshold', p_threshold::text, true);

  return query
  with direct as (
    -- Score the task's own text. word_similarity(query, target) returns the
    -- similarity between the query and the most similar phrase in target, so
    -- document length and word repetition do not inflate it.
    --
    -- Template and department names are included because the ilike fan-out
    -- this function replaces matched them, and dropping them would silently
    -- narrow what `search` can find. Auto-spawned tasks in particular often
    -- have a null title with the only searchable text on the template.
    select
      t.id,
      t.updated_at,
      word_similarity(p_query, coalesce(t.title, ''))           as s_title,
      word_similarity(p_query, coalesce(t.description_text,'')) as s_desc,
      word_similarity(p_query, coalesce(t.property_name, ''))   as s_prop,
      greatest(
        word_similarity(p_query, coalesce(tm.name, '')),
        word_similarity(p_query, coalesce(dp.name, ''))
      )                                                         as s_cat
    from turnover_tasks t
    left join templates tm   on tm.id = t.template_id
    left join departments dp on dp.id = t.department_id
    where t.org_id = p_org
      and (
        p_query <% coalesce(t.title, '')
        or p_query <% coalesce(t.description_text, '')
        or p_query <% coalesce(t.property_name, '')
        or p_query <% coalesce(tm.name, '')
        or p_query <% coalesce(dp.name, '')
      )
  ),
  commented as (
    -- Comments are searched from their own table and rolled up to one score
    -- per task. Keeping them out of the task row is deliberate: folding
    -- comment text into turnover_tasks would make every comment post rewrite
    -- the task row, which is write amplification on the busiest table driven
    -- by the most frequent user action.
    select c.task_id as id, max(word_similarity(p_query, c.comment_content)) as s_comment
    from project_comments c
    where c.org_id = p_org
      and c.task_id is not null
      and p_query <% c.comment_content
    group by c.task_id
  ),
  merged as (
    select
      coalesce(d.id, cm.id) as id,
      coalesce(d.s_title, 0) as s_title,
      coalesce(d.s_desc, 0)  as s_desc,
      coalesce(d.s_prop, 0)  as s_prop,
      coalesce(d.s_cat, 0)   as s_cat,
      coalesce(cm.s_comment, 0) as s_comment
    from direct d
    full outer join commented cm on cm.id = d.id
  ),
  best as (
    select
      m.id,
      greatest(m.s_title, m.s_desc, m.s_prop, m.s_cat, m.s_comment) as sim,
      -- Which field produced the winning score. The agent uses this to decide
      -- whether it still needs to open the task: a comment match means the
      -- relevant text is NOT in the find_tasks projection and get_task is
      -- required to actually read it.
      case greatest(m.s_title, m.s_desc, m.s_prop, m.s_cat, m.s_comment)
        when m.s_title   then 'title'
        when m.s_comment then 'comment'
        when m.s_desc    then 'description'
        when m.s_cat     then 'template_or_department'
        else 'property'
      end as src
    from merged m
  )
  select
    b.id,
    (
      b.sim *
      case
        when p_apply_recency then
          -- Half-life decay on last activity, bucketed to the DAY. Day
          -- granularity is not laziness: bulk writes leave dozens of rows
          -- sharing an exact second, and ranking those against each other
          -- would be ordering on noise from a script run.
          exp(
            -ln(2) * greatest(0, (current_date - t.updated_at::date))::real
            / greatest(p_half_life_days, 1)
          )
        else 1
      end
    )::real as score,
    b.src
  from best b
  join turnover_tasks t on t.id = b.id
  where t.org_id = p_org
  order by score desc, t.updated_at desc
  limit p_limit;
end;
$$;

comment on function public.search_tasks(uuid, text, integer, boolean, real, real) is
  'Ranked task search. Trigram-matches a free-text query against task title, flattened description, property name, and comment bodies; returns task_ids ordered by (match quality x recency decay). Pass p_apply_recency=false when the user named an explicit date range, so historical questions are not penalised for being old.';

grant execute on function public.search_tasks(uuid, text, integer, boolean, real, real)
  to authenticated, service_role;
