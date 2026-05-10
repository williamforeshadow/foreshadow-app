alter table public.users
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null;

create unique index if not exists users_auth_user_id_unique
  on public.users(auth_user_id)
  where auth_user_id is not null;

create index if not exists users_email_lower_idx
  on public.users (lower(email));

comment on column public.users.auth_user_id is
  'Supabase Auth user linked to this Foreshadow app profile.';
