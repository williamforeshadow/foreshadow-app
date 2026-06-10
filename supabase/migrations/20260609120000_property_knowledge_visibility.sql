-- Property knowledge guest-visibility — an allowlist of property-knowledge items
-- the Concierge sub-agent is allowed to see (and therefore may relay to a guest).
--
-- Presence of a row = UNLOCKED (visible to the Concierge). Absence = LOCKED
-- (default). This is the single binary control: the operator-facing ops agent
-- always sees everything via get_property_knowledge; the Concierge only ever
-- sees rows/fields listed here, via get_property_knowledge_for_guest.
--
-- resource_id is the row uuid for collection items (notes, cards, rooms,
-- contacts, documents, tech_accounts) or the column name for the two singleton
-- field-bags (access, connectivity), e.g. 'guest_code' / 'wifi_password'.

create table if not exists public.property_knowledge_visibility (
  id                  uuid primary key default gen_random_uuid(),
  property_id         uuid not null references public.properties(id) on delete cascade,
  resource_type       text not null,
  resource_id         text not null,
  created_by_user_id  text,
  created_at          timestamptz not null default now(),
  unique (property_id, resource_type, resource_id)
);

create index if not exists property_knowledge_visibility_property_idx
  on public.property_knowledge_visibility (property_id);

alter table public.property_knowledge_visibility enable row level security;
-- No policies: all access is service-role through API routes (mirrors the rest
-- of the property-knowledge tables).
