alter table public.channels
  drop constraint if exists channels_created_by_fkey;

alter table public.channels
  add constraint channels_created_by_fkey
  foreign key (created_by)
  references public.users(id)
  on delete set null;
