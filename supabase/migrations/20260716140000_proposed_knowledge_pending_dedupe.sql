-- Make duplicate PENDING knowledge proposals structurally impossible.
--
-- The webhook fires one triage per inbound message. When a guest sends several
-- messages in a burst, those runs overlap -- and each one's first step is to load
-- the "already proposed for this property" digest. They all read it before any
-- has written, all see the same gap, and all propose the same fact. Measured in
-- production once: three identical "Two king beds available" rows, 1.2 seconds
-- apart, same property, same thread. No prompt can fix that; the model is
-- behaving correctly on each run in isolation.
--
-- Scope is (property_id, target) among PENDING rows only:
--   - property, not conversation: the digest is property-scoped, and two threads
--     about the same property proposing the same fact IS a duplicate.
--   - pending only: an accepted/dismissed row is a settled decision and must not
--     block a later re-proposal.
--   - the same target on DIFFERENT properties is NOT a duplicate. A manager with
--     one guest-wifi SSID across the portfolio legitimately proposes identical
--     connectivity per property; that must keep working.
--
-- Collapse the existing duplicates first (keep the earliest of each group), or
-- the index can't be built. Only the one group above is affected.

delete from public.proposed_knowledge p
using (
  select id,
         row_number() over (
           partition by property_id, md5(target::text)
           order by generated_at
         ) as rn
  from public.proposed_knowledge
  where status = 'pending'
    and property_id is not null
    and target is not null
) d
where p.id = d.id
  and d.rn > 1;

create unique index if not exists proposed_knowledge_pending_dedupe
  on public.proposed_knowledge (property_id, md5(target::text))
  where status = 'pending'
    and property_id is not null
    and target is not null;
