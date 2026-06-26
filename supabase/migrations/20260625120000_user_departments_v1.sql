-- User ↔ Department membership (many-to-many). Associates app users with the
-- departments they belong to, so the department detail page can list its
-- members and (later) the concierge can filter assignee candidates by
-- department. A user may belong to several departments; a department has many
-- members.
--
-- FK types match the real PK types: users.id is TEXT, departments.id is UUID.
-- Mirrors the concierge_training_properties join-table conventions.

create table if not exists public.user_departments (
  user_id        text not null references public.users(id) on delete cascade,
  department_id  uuid not null references public.departments(id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (user_id, department_id)
);

-- The detail page looks members up by department; the composite PK already
-- covers user_id-leading lookups.
create index if not exists user_departments_department_idx
  on public.user_departments (department_id);

alter table public.user_departments enable row level security;
-- Intentionally NO policies: all access is service-role through API routes
-- (mirrors concierge_training / notification_property_preferences).
