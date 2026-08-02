-- Fuzzy reservation resolution.
--
-- Completes the resolver set: find_tasks, find_conversations and
-- find_properties all tolerate imperfect input now, and find_reservations was
-- the last one still doing a bare `guest_name ILIKE '%term%'` and returning an
-- empty array when the spelling was off. Guest names are exactly the field
-- where spelling goes wrong -- they arrive from booking channels in whatever
-- form the guest typed, get shortened in conversation, and get misremembered.
--
-- Two deliberate differences from search_properties, because the port is not
-- uniform and copying it wholesale would be wrong:
--
--   1. NO listing fallback tier. find_properties can hand the model the whole
--      property list when nothing matches, because a portfolio is a small,
--      stable, enumerable set -- 40 names is something a model can read and
--      choose from. Reservations number in the hundreds here and grow without
--      bound. Dumping them would be noise, not help, so this resolver has two
--      tiers where properties has three.
--
--   2. NO recency decay. Tasks and conversations both weight recent activity,
--      but for reservations the DATES ARE THE QUERY. find_reservations already
--      carries upcoming / past / current_only / check_in_between and a sort
--      direction. A generic decay would quietly fight all of them -- ranking
--      an upcoming stay below a finished one for the crime of being in the
--      future is the opposite of what "who is arriving next week" wants.
--
-- guest_phone is deliberately NOT matched. Trigram similarity over phone
-- numbers is close to meaningless: every number shares digit trigrams with
-- every other, so a fuzzy phone match would return noise with confident
-- scores. Substring is the correct tool for a phone lookup and that is a
-- separate feature, not this one.

create index if not exists idx_reservations_guest_name_trgm
  on reservations using gin (guest_name gin_trgm_ops);

create index if not exists idx_reservations_guest_email_trgm
  on reservations using gin (guest_email gin_trgm_ops);

create index if not exists idx_reservations_property_name_trgm
  on reservations using gin (property_name gin_trgm_ops);

create or replace function public.search_reservations(
  p_org uuid,
  p_query text,
  p_limit integer default 50,
  -- Same tuned band as the other three search functions. Measured on task
  -- data: 0.50 lets "track" match "trash", 0.65 stops "yard" matching
  -- "backyard". 0.55 is the seat between them.
  p_threshold real default 0.55
)
returns table (reservation_id uuid, score real, matched_in text)
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
      r.id,
      r.check_in,
      word_similarity(p_query, coalesce(r.guest_name, ''))    as s_guest,
      word_similarity(p_query, coalesce(r.guest_email, ''))   as s_email,
      word_similarity(p_query, coalesce(r.property_name, '')) as s_property
    from reservations r
    where r.org_id = p_org
      and (
        p_query <% coalesce(r.guest_name, '')
        or p_query <% coalesce(r.guest_email, '')
        or p_query <% coalesce(r.property_name, '')
      )
  )
  select
    s.id,
    greatest(s.s_guest, s.s_email, s.s_property)::real as score,
    case greatest(s.s_guest, s.s_email, s.s_property)
      when s.s_guest    then 'guest_name'
      when s.s_email    then 'guest_email'
      else 'property_name'
    end as matched_in
  from scored s
  -- Equal-scoring names (a repeat guest, or a family booking under one name)
  -- break toward the more recent stay, which is the likelier subject.
  order by score desc, s.check_in desc nulls last
  limit p_limit;
end;
$$;

comment on function public.search_reservations(uuid, text, integer, real) is
  'Fuzzy reservation resolution. Trigram-matches a query against guest_name, guest_email and property_name; returns reservation_ids ordered by match quality. No recency weighting - find_reservations own date filters are the time axis and a decay would fight them. Phone numbers are deliberately not matched. Used as the second tier of find_reservations: exact substring first, this second.';

grant execute on function public.search_reservations(uuid, text, integer, real)
  to authenticated, service_role;
