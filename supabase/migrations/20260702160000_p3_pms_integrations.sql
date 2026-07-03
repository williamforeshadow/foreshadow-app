-- Multi-tenant P3: per-org PMS credentials.
--
-- Replaces the single global HOSTAWAY_* env vars with a per-org integration
-- row, so two orgs on two PMS accounts can coexist. Holds secrets, so it is
-- service-role only (RLS enabled, NO policies) — org-settings UI reads go
-- through an API route that returns only safe fields.
--
-- credentials shape (jsonb): { "account_id": "...", "client_secret": "..." }.
-- For org 1 we seed an EMPTY row: lib/hostaway.ts falls back to the existing
-- HOSTAWAY_* env vars when a hostaway integration has no stored credentials, so
-- nothing breaks before the secrets are moved into the DB.

begin;

create table if not exists public.pms_integrations (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  provider            text not null check (provider in ('hostaway','hospitable')),
  external_account_id text,                          -- e.g. Hostaway account id (also OAuth client_id)
  credentials         jsonb not null default '{}'::jsonb,
  webhook_secret      text,                          -- per-integration inbound secret
  status              text not null default 'active' check (status in ('active','disabled','error')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (org_id, provider)
);

alter table public.pms_integrations enable row level security;
-- Intentionally NO policies: service-role only (holds credentials).

create index if not exists idx_pms_integrations_provider_account
  on public.pms_integrations (provider, external_account_id);
create index if not exists idx_pms_integrations_webhook_secret
  on public.pms_integrations (webhook_secret);

-- Seed org 1's Hostaway integration (empty creds → env fallback in lib/hostaway.ts).
insert into public.pms_integrations (org_id, provider, status)
select id, 'hostaway', 'active'
from public.organizations where slug = 'kubanda-hostaway'
on conflict (org_id, provider) do nothing;

-- Confirmed dead code (no codebase refs; its /api/sql-query route was removed).
-- A SECURITY DEFINER arbitrary-SQL function — drop it entirely.
drop function if exists public.execute_dynamic_sql(text);

commit;
