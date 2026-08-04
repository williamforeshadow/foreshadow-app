-- A raw k-NN entry point over the embedding corpus.
--
-- WHY THIS EXISTS SEPARATELY from the fusion that will live inside search_tasks:
--
--   1. The evaluation harness (scripts/searchEval.mjs) has to measure the vector
--      channel BEFORE the fused read path is built — otherwise the thresholds
--      that read path needs would have to be guessed, which is the one number in
--      this design that fails silently when it is wrong.
--   2. It returns RAW cosine with no threshold applied, so the harness can sweep
--      the threshold across a range from a single query result set instead of
--      re-querying the database once per candidate value.
--   3. It is a standing diagnostic. "Why did search not find this?" is
--      answerable by calling this directly and looking at the distances.
--
-- The fused path does NOT call this function — it inlines the same CTE so the
-- planner can see the whole query. This is a second implementation of the same
-- idea, kept deliberately: if they disagree, the harness is measuring something
-- other than what ships. Keep the ORDER BY / LIMIT shape in step.
--
-- k-NN FIRST, filter second. The `order by embedding <=> query limit k` shape is
-- what makes the HNSW index usable. Applying a distance threshold in the WHERE
-- clause instead would silently turn this into a sequential scan over every
-- vector in the table.

create or replace function public.search_embeddings_knn(
  p_org             uuid,
  p_query_embedding text,
  p_model           text    default 'text-embedding-3-small',
  p_limit           integer default 200,
  p_source_types    text[]  default array['task', 'comment', 'message']
)
returns table (source_type text, source_id uuid, cos real)
language plpgsql
stable
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_q vector(1536);
begin
  v_q := p_query_embedding::vector(1536);

  -- pgvector 0.8's iterative scan. Without this, a small tenant inside a large
  -- shared index gets its rows filtered out AFTER the graph walk has already
  -- chosen its candidates, so a request for 200 rows can quietly return 3. This
  -- keeps pulling further batches until the LIMIT is satisfied or max_scan_tuples
  -- is exhausted.
  --
  -- relaxed_order, not strict_order: every caller re-sorts downstream (the
  -- harness by fused score, the read path by similarity x recency), so paying
  -- for exact distance ordering here buys nothing.
  perform set_config('hnsw.iterative_scan', 'relaxed_order', true);
  perform set_config('hnsw.ef_search', '100', true);
  perform set_config('hnsw.max_scan_tuples', '40000', true);

  return query
  select
    e.source_type,
    e.source_id,
    (1 - (e.embedding <=> v_q))::real as cos
  from public.search_embeddings e
  where e.org_id = p_org
    and e.model = p_model
    and e.embedding is not null
    and e.source_type = any(p_source_types)
  order by e.embedding <=> v_q
  limit p_limit;
end$$;

comment on function public.search_embeddings_knn(uuid, text, text, integer, text[]) is
  'Raw k-NN over search_embeddings, returning cosine SIMILARITY (1 - distance) with no threshold applied so callers can sweep one. Used by scripts/searchEval.mjs and for diagnosing why a query did or did not match. The fused read path inlines this same shape rather than calling it.';

grant execute on function public.search_embeddings_knn(uuid, text, text, integer, text[])
  to authenticated, service_role;
