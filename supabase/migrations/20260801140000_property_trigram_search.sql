-- Fuzzy property resolution.
--
-- find_properties is the most load-bearing resolver in the tool catalog:
-- nearly every other tool starts by turning a property name into an id here.
-- When it fails, the failure is not one missing search result, it is "I don't
-- know which property you mean" for a request that was perfectly valid.
--
-- Today it does `name ILIKE '%term%' OR hostaway_name ILIKE '%term%'` and
-- returns an empty array when that misses. Two observed consequences:
--
--   1. Spelling divergence breaks it outright. This org's properties are named
--      "Aqua Vista #508" while 15 of its own outbound guest messages say
--      "Acqua Vista Condo". Searching the spelling the guest was given returns
--      nothing; trigram scores it 0.67 and finds all three units.
--
--   2. Worse, it fails silently and the operator has to prod. The reported
--      pattern is: ask about a property, get told it can't be found, reply
--      "look again", and the model then calls find_properties with NO query,
--      reads the full list, and identifies it immediately. The capability was
--      always there. It just took a second turn to reach.
--
-- This function is the middle tier of the fix; see findProperties.ts for the
-- three-tier fallback that uses it. No recency decay here, unlike the task and
-- conversation searches: properties do not go stale, and ranking a rental by
-- how recently its row was edited would be meaningless.
--
-- Address columns are matched even though this org has them almost entirely
-- null. That is a data-entry state, not a product truth: in other tenants the
-- address may be the only reliable handle on a property, and it should not
-- depend on the local accident that Hostaway listing labels here happen to
-- begin with a street address.

create index if not exists idx_properties_name_trgm
  on properties using gin (name gin_trgm_ops);

create index if not exists idx_properties_hostaway_name_trgm
  on properties using gin (hostaway_name gin_trgm_ops);

create index if not exists idx_properties_address_street_trgm
  on properties using gin (address_street gin_trgm_ops);

create or replace function public.search_properties(
  p_org uuid,
  p_query text,
  p_limit integer default 25,
  -- Same tuned band as search_tasks and search_conversations. Measured there:
  -- 0.50 lets "track" match "trash", 0.65 stops "yard" matching "backyard".
  p_threshold real default 0.55,
  p_active_only boolean default true
)
returns table (property_id uuid, score real, matched_in text)
language plpgsql
stable
security invoker
set search_path = public, pg_catalog
as $$
begin
  -- `<%` tests against a session GUC rather than a literal, so set it locally
  -- (third arg true = this transaction only). Using the operator rather than a
  -- bare word_similarity() comparison is what lets the GIN indexes get used.
  perform set_config('pg_trgm.word_similarity_threshold', p_threshold::text, true);

  return query
  with scored as (
    select
      p.id,
      p.name,
      word_similarity(p_query, coalesce(p.name, ''))           as s_name,
      word_similarity(p_query, coalesce(p.hostaway_name, ''))  as s_hostaway,
      greatest(
        word_similarity(p_query, coalesce(p.address_street, '')),
        word_similarity(p_query, coalesce(p.address_city, '')),
        word_similarity(p_query, coalesce(p.address_zip, ''))
      )                                                        as s_address
    from properties p
    where p.org_id = p_org
      and (not p_active_only or p.is_active = true)
      and (
        p_query <% coalesce(p.name, '')
        or p_query <% coalesce(p.hostaway_name, '')
        or p_query <% coalesce(p.address_street, '')
        or p_query <% coalesce(p.address_city, '')
        or p_query <% coalesce(p.address_zip, '')
      )
  )
  select
    s.id,
    greatest(s.s_name, s.s_hostaway, s.s_address)::real as score,
    case greatest(s.s_name, s.s_hostaway, s.s_address)
      when s.s_name     then 'name'
      when s.s_hostaway then 'hostaway_name'
      else 'address'
    end as matched_in
  from scored s
  -- Name ties break alphabetically so repeated identical queries are stable.
  order by score desc, s.name asc
  limit p_limit;
end;
$$;

comment on function public.search_properties(uuid, text, integer, real, boolean) is
  'Fuzzy property resolution. Trigram-matches a query against name, hostaway_name, and address fields; returns property_ids ordered by match quality. No recency weighting - properties do not go stale. Used as the middle tier of find_properties: exact substring first, this second, full listing third.';

grant execute on function public.search_properties(uuid, text, integer, real, boolean)
  to authenticated, service_role;
