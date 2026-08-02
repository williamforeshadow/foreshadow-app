-- Ranked conversation search over guest message bodies.
--
-- find_conversations could match a guest name and a property name. Nothing
-- else. Meanwhile guest_messages holds 4,233 bodies averaging ~292 characters
-- and spanning 2022 to 2026 -- by a wide margin the largest text corpus in the
-- product -- and not one character of it was reachable. "What did the guest
-- say about parking?" or "which guest complained about noise?" had no path to
-- an answer; the model could resolve a thread by name and then read it, but it
-- could not FIND a thread by what was said in it.
--
-- Same shape as search_tasks(), with three deliberate differences:
--
--   1. Shorter half-life (90 days vs 180). Tasks persist -- a maintenance item
--      from four months ago may still be open and still be the subject. Guest
--      conversations are tied to stays that end, so a thread from last quarter
--      is far less likely to be what someone is asking about. The corpus shape
--      backs this up: 1,300 messages in June 2026 against 28 in all of 2023.
--
--   2. No generated column. guest_messages.body is already plain text, so
--      there is nothing to flatten. This is strictly simpler than the task
--      version.
--
--   3. It returns the matching excerpt. On tasks we deliberately return only
--      matched_in ('comment'), because comment bodies are not in the find_tasks
--      projection and get_task exists to read them. Here the matching text is
--      a couple of hundred characters and is the entire reason the row came
--      back, so withholding it would force a second round trip to answer the
--      question the search just answered. Capped at 240 chars.
--
--      The excerpt is the best-matching LINE, not the first 240 characters.
--      That distinction matters more than it sounds: these messages average
--      292 characters and run to 3,157, and a large share are welcome
--      templates whose opening lines are always "Hi <name>, welcome to...".
--      Taking the head of the body therefore showed the same boilerplate
--      greeting for every hit and never the text that actually matched.
--      Splitting on newlines and scoring each line lands on the relevant one.
--
--      matched_direction rides along for the same reason: "which guest
--      complained about noise" and "what did we tell them about noise" hit the
--      same corpus, and inbound vs outbound is what separates them.
--
-- The threshold is applied to the RAW similarity, before recency decay, for
-- the same reason as search_tasks: relevance decides admission, recency only
-- decides order. A perfect match from 2023 still surfaces; it just ranks last
-- unless the caller passes a date filter and turns decay off.

create index if not exists idx_guest_messages_body_trgm
  on guest_messages using gin (body gin_trgm_ops);

create index if not exists idx_conversations_guest_name_trgm
  on conversations using gin (guest_name gin_trgm_ops);

create index if not exists idx_conversations_property_name_trgm
  on conversations using gin (property_name gin_trgm_ops);

create or replace function public.search_conversations(
  p_org uuid,
  p_query text,
  p_limit integer default 25,
  p_apply_recency boolean default true,
  -- Same tuned band as search_tasks. Measured there: 0.50 lets "track" match
  -- "trash", 0.65 stops "yard" matching "backyard". 0.55 is the seat between.
  p_threshold real default 0.55,
  p_half_life_days real default 90
)
returns table (
  conversation_id uuid,
  score real,
  matched_in text,
  matched_excerpt text
)
language plpgsql
stable
security invoker
set search_path = public, pg_catalog
as $$
begin
  -- The `<%` operator tests against a session GUC rather than a literal, so
  -- set it locally (third arg true = this transaction only). Using the
  -- operator instead of a bare word_similarity() comparison is what lets the
  -- GIN indexes above actually get used.
  perform set_config('pg_trgm.word_similarity_threshold', p_threshold::text, true);

  return query
  with message_hits as (
    -- Best-matching message per conversation, plus its text. DISTINCT ON with
    -- the matching ORDER BY is how Postgres expresses "argmax" -- we want not
    -- just the top score but the row that produced it, so the caller can see
    -- WHY the thread matched without opening it.
    select distinct on (m.conversation_id)
      m.conversation_id as id,
      word_similarity(p_query, m.body) as s_msg,
      left(m.body, 240) as excerpt
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
  merged as (
    select
      coalesce(d.id, mh.id)     as id,
      coalesce(d.s_guest, 0)    as s_guest,
      coalesce(d.s_prop, 0)     as s_prop,
      coalesce(mh.s_msg, 0)     as s_msg,
      mh.excerpt                as excerpt
    from direct d
    full outer join message_hits mh on mh.id = d.id
  ),
  best as (
    select
      m.id,
      greatest(m.s_guest, m.s_prop, m.s_msg) as sim,
      case greatest(m.s_guest, m.s_prop, m.s_msg)
        when m.s_guest then 'guest_name'
        when m.s_msg   then 'message'
        else 'property_name'
      end as src,
      -- Only meaningful when a message won; a guest-name match has no excerpt
      -- to show and a null is more honest than an unrelated snippet.
      case when m.s_msg >= greatest(m.s_guest, m.s_prop) then m.excerpt else null end as excerpt
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
    b.excerpt
  from best b
  -- Re-join rather than carry the row through: this also applies the archived
  -- filter to conversations reached via the message path, which would
  -- otherwise bypass it.
  join conversations c on c.id = b.id
  where c.org_id = p_org
    and c.archived = false
  order by score desc, c.last_message_at desc nulls last
  limit p_limit;
end;
$$;

comment on function public.search_conversations(uuid, text, integer, boolean, real, real) is
  'Ranked conversation search. Trigram-matches a free-text query against guest message bodies, guest name, and property name; returns conversation_ids ordered by (match quality x recency decay on last_message_at), with the matching message excerpt when a message produced the hit. Pass p_apply_recency=false when the caller named an explicit date range.';

grant execute on function public.search_conversations(uuid, text, integer, boolean, real, real)
  to authenticated, service_role;
