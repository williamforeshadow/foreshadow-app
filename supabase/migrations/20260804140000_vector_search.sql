-- Semantic search, part 2 of 2: fuse the vector score into the ranking.
--
-- 20260731120000_task_trigram_search.sql closed with the boundary it could not
-- cross, measured:
--
--     landscaping   "Get a gardener..."   0.08   no
--
-- This migration closes it. Measured on a 2,000-row synthetic corpus with
-- ground truth (scripts/searchEval.mjs, 58 queries over 20 concepts), where
-- each concept's documents were written to share NO usable trigram with its
-- queries:
--
--   mode      hit@5   hit@10   MRR     prec@5   | semantic  lexical  both
--   trigram   13.8%   13.8%    0.121   10.1%    |     4%      75%     50%
--   vector    46.6%   46.6%    0.414   34.9%    |    46%      50%     50%
--   hybrid    51.7%   51.7%    0.434   36.5%    |    48%      75%     67%
--   cascade   48.3%   48.3%    0.422   35.1%    |    44%      75%     67%
--
-- The last three columns are the point. Semantic recall goes 4% -> 48%, and
-- lexical recall does NOT move (75% -> 75%). Adding a second channel to a
-- ranking usually costs you something on the queries the first channel already
-- answered; here it does not, and that was the gate for shipping always-on
-- fusion rather than only falling back to vectors on weak lexical results.
--
-- Hybrid also beat cascade (fall back to vectors only when trigram is weak) on
-- every metric, so the extra query latency buys real recall.
--
--
-- THE THRESHOLD, AND WHY IT IS 0.44
--
-- Cosine similarity for a SHORT query against a LONGER document does not live
-- in [0,1] the way intuition suggests — it lives in a compressed band. Measured
-- on the real corpus:
--
--   "the internet is down"  -> "I think the WiFi is down"        0.488   good
--   "hot water not working" -> "trying to shower ... let it heat" 0.575   good
--   "landscaping"           -> "what day does the landscaper come" 0.477  good
--   "bugs in the unit"      -> "Fix AC - unit not cooling"        0.413   WRONG
--
-- And on synthetic near-miss queries — written in property-ops register but with
-- no answer anywhere in the corpus, which is the case that produces confident
-- fiction:
--
--   "guest lost their passport" -> "Guest left bags in the entry"  0.432   WRONG
--   "ski storage locker is full"-> "Locking cabinet in the garage" 0.410   WRONG
--   "EV charger not delivering" -> "HVAC compressor not kicking on" 0.356  WRONG
--   "beach umbrella rental"     -> "Hire a crew to mow and edge"   0.362   WRONG
--
-- True matches observed at 0.477-0.575; false ones at 0.356-0.432. 0.44 sits in
-- the gap: it admits every true match observed and rejects every false one,
-- including the 0.432 near-miss that an earlier guess of 0.42 would have let
-- through.
--
-- WHY THERE IS A CEILING AS WELL AS A FLOOR
--
-- The first cut of this rescaled with (cos - floor) / (1 - floor), i.e. it
-- assumed a perfect match scores 1.0. Cosine for a short query against a longer
-- document never gets near 1.0 — the good matches above top out around 0.58. So
-- the vector channel's entire output range was [0, 0.14] and it could not
-- outrank even a partial trigram hit. Measured on the real corpus before the
-- fix: a correct semantic match on "appliance is broken" scored 0.24, and one on
-- "guests complaining about the internet" scored 0.01, against 1.00 for a
-- literal title match.
--
-- That is wrong twice over. It breaks fusion, and it corrupts match_score, which
-- find_tasks hands to the model with instructions to compare scores against each
-- other — 0.01 reads as noise when it is in fact the best semantic evidence
-- available.
--
-- p_vector_ceiling is the observed top of the useful band, so the rescale maps
-- [floor, ceiling] onto [0, weight] instead of [floor, 1.0]. At 0.62 a strong
-- paraphrase (~0.575) scores ~0.68 — competitive with a partial lexical match,
-- still below a perfect literal one. Tune it with the harness, not by feel.
--
-- Do NOT tune this by feel. The sweep in scripts/searchEval.mjs prints the whole
-- recall/precision/false-positive curve; the honest summary is that recall AND
-- precision both improve as the floor drops, so the floor's only real job is
-- rejecting queries that have no answer at all. That makes it a product
-- judgement about which failure is worse, not a number to optimise.
--
--
-- WHY DROP-THEN-CREATE AND NOT `create or replace`
--
-- Postgres keys functions by (name, argument types), so `create or replace` with
-- additional parameters creates a SECOND function rather than replacing the
-- first. Both would then match the existing four-named-argument call from
-- findTasks.ts, Postgres would raise "function is not unique", and PostgREST
-- would surface PGRST203 — breaking every search in the product. The drop is
-- mandatory, and the grant must be re-issued because it dies with the function.

drop function if exists public.search_tasks(uuid, text, integer, boolean, real, real);
drop function if exists public.search_conversations(uuid, text, integer, boolean, real, real);

-- ---------------------------------------------------------------------------
-- search_tasks
-- ---------------------------------------------------------------------------
create or replace function public.search_tasks(
  p_org              uuid,
  p_query            text,
  p_limit            integer default 50,
  p_apply_recency    boolean default true,
  p_threshold        real    default 0.55,
  p_half_life_days   real    default 180,
  -- Vector channel. Null embedding = trigram only, byte-identical to before.
  p_query_embedding  text    default null,
  p_vector_threshold real    default 0.44,
  p_vector_k         integer default 300,
  p_vector_weight    real    default 0.90,
  p_model            text    default 'text-embedding-3-small',
  p_vector_ceiling   real    default 0.62
)
returns table (task_id uuid, score real, matched_in text)
language plpgsql
stable
security invoker
set search_path = public, pg_catalog
as $function$
declare
  v_q vector(1536);
begin
  perform set_config('pg_trgm.word_similarity_threshold', p_threshold::text, true);

  -- p_query_embedding is TEXT rather than vector because PostgREST does not
  -- reliably coerce a JSON array into an extension type. JSON.stringify(vec)
  -- produces exactly pgvector's input literal, so this cast is unambiguous.
  if p_query_embedding is not null then
    v_q := p_query_embedding::vector(1536);
    -- pgvector 0.8 iterative scan. Without it, a small tenant inside a large
    -- shared HNSW index has its rows filtered out AFTER the graph has chosen
    -- candidates, so asking for 300 can quietly return 3 — and it degrades
    -- silently, which is the worst way for a recall bug to behave.
    -- relaxed_order because the outer query re-sorts by sim * decay anyway.
    perform set_config('hnsw.iterative_scan', 'relaxed_order', true);
    perform set_config('hnsw.ef_search', '100', true);
    perform set_config('hnsw.max_scan_tuples', '40000', true);
  end if;

  return query
  with direct as (
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
    select c.task_id as id, max(word_similarity(p_query, c.comment_content)) as s_comment
    from project_comments c
    where c.org_id = p_org
      and c.task_id is not null
      and p_query <% c.comment_content
    group by c.task_id
  ),
  -- k-NN FIRST, threshold SECOND. Inverting these (putting the distance test in
  -- the WHERE clause) makes the HNSW index unusable and silently turns this into
  -- a sequential scan over every vector in the table.
  vec_units as (
    select e.source_type, e.source_id, (1 - (e.embedding <=> v_q)) as cos
    from search_embeddings e
    where v_q is not null
      and e.org_id = p_org
      and e.model = p_model
      and e.embedding is not null
      and e.source_type in ('task', 'comment')
    order by e.embedding <=> v_q
    limit p_vector_k
  ),
  vec_tasks as (
    select
      coalesce(c.task_id, v.source_id) as id,
      -- Rescale so the two channels are comparable: word_similarity is [0,1]
      -- above a 0.55 floor, cosine sits in a compressed band. Mapping the
      -- vector floor to 0 and capping at p_vector_weight (< 1) means a perfect
      -- paraphrase ranks just below a perfect literal match — the right prior
      -- when the user typed words that are actually in the title.
      max(
        least(
          1.0,
          (v.cos - p_vector_threshold)
            / nullif(p_vector_ceiling - p_vector_threshold, 0)
        ) * p_vector_weight
      )::real as s_vec,
      -- argmax over the winning unit, so matched_in stays truthful about
      -- whether the text lives on the task or in a comment.
      (array_agg(v.source_type order by v.cos desc))[1] as vec_src
    from vec_units v
    left join project_comments c
      on v.source_type = 'comment' and c.id = v.source_id and c.org_id = p_org
    where v.cos >= p_vector_threshold
      -- A comment with no task_id would otherwise coalesce to its own id and be
      -- reported as a task that does not exist.
      and (v.source_type = 'task' or c.task_id is not null)
    group by 1
  ),
  merged as (
    select
      coalesce(d.id, cm.id, vt.id) as id,
      coalesce(d.s_title, 0)       as s_title,
      coalesce(d.s_desc, 0)        as s_desc,
      coalesce(d.s_prop, 0)        as s_prop,
      coalesce(d.s_cat, 0)         as s_cat,
      coalesce(cm.s_comment, 0)    as s_comment,
      coalesce(vt.s_vec, 0)        as s_vec,
      vt.vec_src                   as vec_src
    from direct d
    full outer join commented cm on cm.id = d.id
    full outer join vec_tasks vt on vt.id = coalesce(d.id, cm.id)
  ),
  best as (
    select
      m.id,
      greatest(m.s_title, m.s_desc, m.s_prop, m.s_cat, m.s_comment, m.s_vec) as sim,
      -- Order matters: on a tie the earlier branch wins, so a literal title
      -- match is always attributed to the title rather than to the vector.
      case greatest(m.s_title, m.s_desc, m.s_prop, m.s_cat, m.s_comment, m.s_vec)
        when m.s_title   then 'title'
        when m.s_comment then 'comment'
        when m.s_desc    then 'description'
        when m.s_cat     then 'template_or_department'
        -- Deliberately reuses the existing vocabulary rather than adding
        -- 'semantic': the value set is documented in find_tasks' tool
        -- description, so a new value would be a prompt change. These two also
        -- happen to carry the right meaning — a semantic hit means the user's
        -- words are NOT in the row, so "open the task and read it" is correct.
        when m.s_vec     then case when m.vec_src = 'comment'
                                   then 'comment' else 'description' end
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
$function$;

comment on function public.search_tasks(uuid, text, integer, boolean, real, real, text, real, integer, real, text, real) is
  'Ranked task search: trigram similarity fused with vector similarity, times a recency decay. Pass p_query_embedding (a JSON array string) to enable the semantic channel; omit it for trigram-only, which is byte-identical to the pre-vector behaviour. p_vector_weight = 0 disables the vector channel at runtime without a migration.';

grant execute on function public.search_tasks(uuid, text, integer, boolean, real, real, text, real, integer, real, text, real)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- search_conversations
-- ---------------------------------------------------------------------------
-- guest_messages is by a wide margin the largest text corpus in the product
-- (~4.3k bodies averaging ~292 chars), and it is also where vocabulary mismatch
-- bites hardest: guests never use internal wording.
create or replace function public.search_conversations(
  p_org              uuid,
  p_query            text,
  p_limit            integer default 25,
  p_apply_recency    boolean default true,
  p_threshold        real    default 0.55,
  p_half_life_days   real    default 90,
  p_query_embedding  text    default null,
  p_vector_threshold real    default 0.44,
  p_vector_k         integer default 300,
  p_vector_weight    real    default 0.90,
  p_model            text    default 'text-embedding-3-small',
  p_vector_ceiling   real    default 0.62
)
returns table (
  conversation_id  uuid,
  score            real,
  matched_in       text,
  matched_excerpt  text,
  matched_direction text
)
language plpgsql
stable
security invoker
set search_path = public, pg_catalog
as $function$
declare
  v_q vector(1536);
begin
  perform set_config('pg_trgm.word_similarity_threshold', p_threshold::text, true);

  if p_query_embedding is not null then
    v_q := p_query_embedding::vector(1536);
    perform set_config('hnsw.iterative_scan', 'relaxed_order', true);
    perform set_config('hnsw.ef_search', '100', true);
    perform set_config('hnsw.max_scan_tuples', '40000', true);
  end if;

  return query
  with message_hits as (
    select distinct on (m.conversation_id)
      m.conversation_id as id,
      word_similarity(p_query, m.body) as s_msg,
      m.direction as dir,
      (
        select left(trim(ln), 240)
        from unnest(string_to_array(m.body, E'\n')) as ln
        where length(trim(ln)) > 0
        order by word_similarity(p_query, ln) desc
        limit 1
      ) as excerpt
    from guest_messages m
    where m.org_id = p_org
      and m.conversation_id is not null
      and p_query <% m.body
    order by m.conversation_id, word_similarity(p_query, m.body) desc, m.sent_at desc
  ),
  direct as (
    select
      c.id,
      word_similarity(p_query, coalesce(c.guest_name, ''))    as s_guest,
      word_similarity(p_query, coalesce(c.property_name, '')) as s_prop
    from conversations c
    where c.org_id = p_org
      and c.archived = false
      and (
        p_query <% coalesce(c.guest_name, '')
        or p_query <% coalesce(c.property_name, '')
      )
  ),
  vec_units as (
    select e.source_id, (1 - (e.embedding <=> v_q)) as cos
    from search_embeddings e
    where v_q is not null
      and e.org_id = p_org
      and e.model = p_model
      and e.embedding is not null
      and e.source_type = 'message'
    order by e.embedding <=> v_q
    limit p_vector_k
  ),
  vec_convs as (
    select distinct on (m.conversation_id)
      m.conversation_id as id,
      (least(
         1.0,
         (v.cos - p_vector_threshold)
           / nullif(p_vector_ceiling - p_vector_threshold, 0)
       ) * p_vector_weight)::real as s_vec,
      -- No word_similarity to rank lines by on this path, so take the head of
      -- the winning message. The whole message is what matched semantically.
      left(trim(m.body), 240) as excerpt,
      m.direction as dir
    from vec_units v
    join guest_messages m on m.id = v.source_id and m.org_id = p_org
    where v.cos >= p_vector_threshold
      and m.conversation_id is not null
    order by m.conversation_id, v.cos desc
  ),
  merged as (
    select
      coalesce(d.id, mh.id, vc.id) as id,
      coalesce(d.s_guest, 0)       as s_guest,
      coalesce(d.s_prop, 0)        as s_prop,
      coalesce(mh.s_msg, 0)        as s_msg,
      coalesce(vc.s_vec, 0)        as s_vec,
      mh.excerpt                   as excerpt,
      mh.dir                       as dir,
      vc.excerpt                   as vec_excerpt,
      vc.dir                       as vec_dir
    from direct d
    full outer join message_hits mh on mh.id = d.id
    full outer join vec_convs vc on vc.id = coalesce(d.id, mh.id)
  ),
  best as (
    select
      m.id,
      greatest(m.s_guest, m.s_prop, m.s_msg, m.s_vec) as sim,
      case greatest(m.s_guest, m.s_prop, m.s_msg, m.s_vec)
        when m.s_guest then 'guest_name'
        when m.s_msg   then 'message'
        when m.s_vec   then 'message'
        else 'property_name'
      end as src,
      -- Show the excerpt from whichever channel actually won, so the operator
      -- sees the text that caused the match rather than an unrelated line.
      case
        when m.s_msg >= greatest(m.s_guest, m.s_prop, m.s_vec) then m.excerpt
        when m.s_vec >= greatest(m.s_guest, m.s_prop)          then m.vec_excerpt
        else null
      end as excerpt,
      case
        when m.s_msg >= greatest(m.s_guest, m.s_prop, m.s_vec) then m.dir
        when m.s_vec >= greatest(m.s_guest, m.s_prop)          then m.vec_dir
        else null
      end as dir
    from merged m
  )
  select
    b.id,
    (
      b.sim *
      case
        when p_apply_recency then
          exp(
            -ln(2) * greatest(0, (current_date - c.last_message_at::date))::real
            / greatest(p_half_life_days, 1)
          )
        else 1
      end
    )::real as score,
    b.src,
    b.excerpt,
    b.dir
  from best b
  join conversations c on c.id = b.id
  where c.org_id = p_org
    and c.archived = false
  order by score desc, c.last_message_at desc nulls last
  limit p_limit;
end;
$function$;

comment on function public.search_conversations(uuid, text, integer, boolean, real, real, text, real, integer, real, text, real) is
  'Ranked conversation search over guest_messages: trigram fused with vector similarity, times a recency decay. Pass p_query_embedding (JSON array string) to enable the semantic channel; omit for trigram-only. matched_excerpt comes from whichever channel won.';

grant execute on function public.search_conversations(uuid, text, integer, boolean, real, real, text, real, integer, real, text, real)
  to authenticated, service_role;
