-- Concierge Training v1 — per-property "agent intelligence" rules the
-- guest-messaging agent references when drafting replies. Each rule is a named
-- operating procedure (title + instructions). A rule applies to a set of
-- properties via the join table, or to every property when applies_to_all.
--
-- Single-tenant for now: no org_id. A future multi-tenant pass would add a
-- nullable org_id column here + a filter; nothing in this migration blocks that.

create table if not exists public.concierge_training (
  id                  uuid primary key default gen_random_uuid(),
  title               text not null,
  instructions        text not null default '',
  applies_to_all      boolean not null default false,
  is_active           boolean not null default true,
  sort_order          integer not null default 0,
  created_by_user_id  text,
  updated_by_user_id  text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists concierge_training_active_idx
  on public.concierge_training (is_active);

-- Which properties a rule applies to. applies_to_all rules need no rows here.
create table if not exists public.concierge_training_properties (
  training_id  uuid not null references public.concierge_training(id) on delete cascade,
  property_id  uuid not null references public.properties(id) on delete cascade,
  primary key (training_id, property_id)
);

create index if not exists concierge_training_properties_property_idx
  on public.concierge_training_properties (property_id);

alter table public.concierge_training enable row level security;
alter table public.concierge_training_properties enable row level security;
-- Intentionally NO policies: all access is service-role through API routes
-- (mirrors guest_messages / conversations).
