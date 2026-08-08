-- Policies & Instructions: a new Property Knowledge section for the rules and
-- standing instructions that apply to the STAY or the WHOLE property rather than
-- to one object — checkout time and departure steps, quiet hours, occupancy
-- limits, parties, smoking, pets, trash day, parking policy.
--
-- Why a section and not more attributes: the concierge's knowledge triage kept
-- proposing these and had only four targets to choose from, so they landed as
-- room attributes under Interior/Exterior — sections meant for facts about
-- physical things in or around the house. The placement boundary is SCOPE:
-- governs one object/area -> attribute on that object; governs the stay or the
-- whole property -> a policy here.
--
-- Shape mirrors property_access_items (a flat, roomless collection): title is
-- the human-readable key AND the key agent operations match on, body carries the
-- instruction. No category vocabulary — ordering is manual via sort_order.
--
-- Guest visibility is unchanged and stays locked-by-default: rows here are
-- invisible to the guest-facing Concierge until an operator unlocks them in
-- Guest Visibility (resource_type 'policy_field').

begin;

create table if not exists public.property_policies (
  id                  uuid primary key default gen_random_uuid(),
  property_id         uuid not null references public.properties(id) on delete cascade,
  -- Short label ("Checkout", "Quiet hours"). Also the match key for the agent's
  -- upsert_policy operation, so it is required and non-empty.
  title               text not null,
  body                text,
  sort_order          integer not null default 0,
  org_id              uuid not null references public.organizations(id) on delete cascade,
  created_by_user_id  text,
  updated_by_user_id  text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists property_policies_property_idx
  on public.property_policies (property_id, sort_order);

-- Fill a NULL org_id from the parent property (same generic trigger the other
-- property child tables use).
drop trigger if exists trg_derive_org_property_policies_property_id
  on public.property_policies;
create trigger trg_derive_org_property_policies_property_id
  before insert on public.property_policies
  for each row execute function public.derive_org_id('properties', 'property_id');

-- Per-org RLS (service role bypasses; user-scoped clients are isolated).
alter table public.property_policies enable row level security;
drop policy if exists org_isolation on public.property_policies;
create policy org_isolation on public.property_policies
  for all to authenticated
  using (org_id in (select public.app_current_user_orgs()))
  with check (org_id in (select public.app_current_user_orgs()));

commit;
